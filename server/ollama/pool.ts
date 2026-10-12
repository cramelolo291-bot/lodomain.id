// The pool scheduler.
//
// The pattern comes straight from container pooling: pick the healthiest target
// that has a free slot, claim it, do the work, settle it. Two things separate
// this from a naive round-robin:
//
//   - claiming is a conditional UPDATE, so two concurrent requests physically
//     cannot both take the last slot (no read-then-write race)
//   - a 401 or 429 puts that account in cooldown instead of failing the turn,
//     so the next request goes to a different upstream
//
// `in_flight` is incremented and decremented in SQL. If a process dies
// mid-request the counter is wrong, so `resetOrphans` repairs it on boot.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { pool, type Db } from "../db/client";
import { poolAccounts, usageEvents } from "../db/schema";
import { env } from "../env";

export type Account = {
  id: string;
  label: string;
  tier: string;
  status: "healthy" | "degraded" | "cooling" | "disabled";
  health: number;
  inFlight: number;
  maxSlots: number;
  successes: number;
  failures: number;
};

export type Claimed = Account & { model: string };

/**
 * Claims a slot. One statement, so the check and the increment cannot be
 * interleaved with another request's.
 *
 * Ordered by: not cooling, then not busy, then healthiest. A cooling account
 * is only considered once everything else is exhausted.
 */
export async function claim(db: Db, model: string): Promise<Claimed | null> {
  const now = new Date();

  const candidates = await db
    .select()
    .from(poolAccounts)
    .where(
      and(
        eq(poolAccounts.status, "healthy"),
        sql`${poolAccounts.inFlight} < ${poolAccounts.maxSlots}`,
      ),
    )
    .orderBy(
      // Prefer accounts not currently serving a request.
      asc(sql`${poolAccounts.inFlight} > 0`),
      // Prefer accounts not in cooldown.
      asc(sql`${poolAccounts.cooldownUntil} is not null and ${poolAccounts.cooldownUntil} > now()`),
      desc(poolAccounts.health),
    )
    .limit(8);

  for (const account of candidates) {
    const cooling = account.cooldownUntil && account.cooldownUntil > now;
    if (cooling) continue;

    const updated = await db
      .update(poolAccounts)
      .set({ inFlight: sql`${poolAccounts.inFlight} + 1` })
      .where(
        and(
          eq(poolAccounts.id, account.id),
          sql`${poolAccounts.inFlight} < ${poolAccounts.maxSlots}`,
        ),
      )
      .returning();

    if (updated[0]) {
      return { ...(updated[0] as Account), model };
    }
  }

  return null;
}

export type Outcome = {
  ok: boolean;
  /** Upstream said 401/429/5xx: cool this account down and try another. */
  retryable: boolean;
  cooldownMs: number;
};

/**
 * Settles a claim: releases the slot, records the outcome, adjusts health.
 * Success nudges health up by 1; failure knocks 10 off, floored at 0, and the
 * account is marked degraded once it drops under 50.
 */
export async function settle(db: Db, accountId: string, outcome: Outcome): Promise<void> {
  const now = Date.now();

  await db
    .update(poolAccounts)
    .set({
      inFlight: sql`greatest(0, ${poolAccounts.inFlight} - 1)`,
      successes: sql`${poolAccounts.successes} + ${outcome.ok ? 1 : 0}`,
      failures: sql`${poolAccounts.failures} + ${outcome.ok ? 0 : 1}`,
      health: sql`least(100, greatest(0, ${poolAccounts.health} + ${outcome.ok ? 1 : -10}))`,
      status: sql`case
        when ${poolAccounts.status} = 'disabled' then 'disabled'::account_status
        when ${poolAccounts.health} + ${outcome.ok ? 1 : -10} < 50 then 'degraded'::account_status
        else ${poolAccounts.status}::account_status
      end`,
      cooldownUntil: outcome.cooldownMs
        ? new Date(now + outcome.cooldownMs)
        : null,
      lastUsedAt: new Date(now),
    })
    .where(eq(poolAccounts.id, accountId));
}

/** Turns an upstream status into a settle decision. */
export function classify(status: number): Outcome {
  if (status === 401 || status === 403) {
    return { ok: false, retryable: true, cooldownMs: env.COOLDOWN_MS * 6 };
  }
  if (status === 429) {
    return { ok: false, retryable: true, cooldownMs: env.COOLDOWN_MS * 2 };
  }
  if (status >= 500) {
    return { ok: false, retryable: true, cooldownMs: env.COOLDOWN_MS };
  }
  return { ok: false, retryable: false, cooldownMs: 0 };
}

export const okOutcome: Outcome = { ok: true, retryable: false, cooldownMs: 0 };

export async function recordUsage(
  db: Db,
  row: {
    userId: string | null;
    accountId: string | null;
    model: string;
    agent: string;
    effort?: string | null;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    ok: boolean;
  },
): Promise<void> {
  await db.insert(usageEvents).values(row);
}

/**
 * A crashed process leaves `in_flight` above zero forever, which permanently
 * starves that account. Run on boot.
 */
export async function resetOrphans(): Promise<number> {
  const rows = await pool<{ id: string }[]>`
    update pool_accounts
       set in_flight = 0
     where in_flight > 0
    returning id
  `;
  return rows.length;
}

/** Expired cooldowns become healthy again. */
export async function clearExpiredCooldowns(): Promise<number> {
  const rows = await pool<{ id: string }[]>`
    update pool_accounts
       set cooldown_until = null,
           status = case when status = 'cooling' then 'healthy'::account_status else status end
     where cooldown_until is not null
       and cooldown_until < now()
    returning id
  `;
  return rows.length;
}

export type Summary = {
  accounts: number;
  healthy: number;
  degraded: number;
  disabled: number;
  totalInFlight: number;
  totalSlots: number;
  averageHealth: number;
};

export async function summary(db: Db): Promise<Summary> {
  const rows = await db
    .select({
      status: poolAccounts.status,
      health: poolAccounts.health,
      inFlight: poolAccounts.inFlight,
      maxSlots: poolAccounts.maxSlots,
    })
    .from(poolAccounts);

  const count = (s: Account["status"]) => rows.filter((r) => r.status === s).length;
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((n, r) => n + pick(r), 0);

  return {
    accounts: rows.length,
    healthy: count("healthy"),
    degraded: count("degraded"),
    disabled: count("disabled"),
    totalInFlight: sum((r) => r.inFlight),
    totalSlots: sum((r) => r.maxSlots),
    averageHealth: rows.length ? Math.round(sum((r) => r.health) / rows.length) : 0,
  };
}

/** Drops rows that are cooling right now, for the pool view. */
export async function withLiveStatus(db: Db): Promise<Account[]> {
  const rows = await db
    .select()
    .from(poolAccounts)
    .orderBy(asc(sql`${poolAccounts.inFlight} > 0`), desc(poolAccounts.health));

  const now = Date.now();
  return rows.map((r) => {
    const cooling = r.cooldownUntil && r.cooldownUntil.getTime() > now;
    return {
      ...(r as Account),
      status: cooling ? "cooling" : r.status,
    };
  });
}
