// Magic-link sign-in.
//
// Three rules this file exists to enforce:
//   1. the token is stored hashed, never raw
//   2. a link works exactly once (`usedAt` is set in the same statement)
//   3. requesting a link never reveals whether the account exists

import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { db } from "../db/client";
import { magicLinks, users } from "../db/schema";
import { env } from "../env";
import { generateToken, hashToken } from "./tokens";

export class LinkError extends Error {
  status: ContentfulStatusCode;

  constructor(message: string, status: ContentfulStatusCode) {
    super(message);
    this.name = "LinkError";
    this.status = status;
  }
}

function nameFromEmail(email: string): string {
  return (
    email
      .split("@")[0]!
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "Lolo"
  );
}

async function sendEmail(to: string, link: string): Promise<void> {
  const html = `<!doctype html>
<html><body style="margin:0;background:#0a0b0e;font-family:ui-sans-serif,system-ui,sans-serif;color:#e8e6e3">
  <div style="max-width:520px;margin:0 auto;padding:48px 24px">
    <p style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8b8781;margin:0 0 24px">Lolo AI</p>
    <h1 style="font-size:26px;line-height:1.3;margin:0 0 12px;font-weight:500">Masuk ke workspace lo</h1>
    <p style="font-size:15px;line-height:1.7;color:#a9a5a0;margin:0 0 28px">
      Tombol di bawah berlaku sekali dan kedaluwarsa dalam ${env.MAGIC_LINK_TTL_MINUTES} menit.
      Kalau bukan lo yang minta, abaikan saja — nggak ada yang berubah.
    </p>
    <a href="${link}" style="display:inline-block;background:#d97757;color:#17120f;text-decoration:none;
       font-size:15px;font-weight:500;padding:12px 24px;border-radius:999px">Masuk</a>
    <p style="font-size:12px;line-height:1.7;color:#6b6763;margin:32px 0 0;word-break:break-all">${link}</p>
  </div>
</body></html>`;

  if (!env.RESEND_API_KEY) {
    // No key configured. Log it instead of silently failing, so a fresh
    // checkout is usable before anyone signs up for a mail provider.
    console.log(`\n[magic-link] ${to}\n[magic-link] ${link}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: "Masuk ke Lolo AI",
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new LinkError(`Email gagal dikirim: ${res.status} ${body}`, 502);
  }
}

/**
 * Issues a link. Creates the account on first use, so sign-up and sign-in are
 * the same action and the response is identical whether or not the user exists.
 */
export async function requestMagicLink(email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    throw new LinkError("Email tidak valid", 400);
  }

  // In production, access is closed by default. Unknown addresses receive the
  // same outward response as allowed addresses, but no link is issued or sent.
  if (!isAllowedLoginEmail(address)) return;
  // Never log bearer login links in production when email delivery is missing.
  if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
    throw new LinkError("Email delivery is not configured for this deployment", 503);
  }

  const token = generateToken();
  await db.insert(magicLinks).values({
    email: address,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + env.MAGIC_LINK_TTL_MINUTES * 60_000),
  });

  await sendEmail(address, `${env.APP_URL}/auth/verify?token=${token}`);
}

export type Verified = { userId: string; email: string; name: string; role: "admin" | "user" };

/** Normalize and check the explicit production administrator allowlist. */
export function isConfiguredAdminEmail(email: string, configured = env.ADMIN_EMAILS): boolean {
  const allowed = new Set(configured.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  return allowed.has(email.trim().toLowerCase());
}

/** Production sign-in is restricted to exact allowlisted addresses. */
export function isAllowedLoginEmail(
  email: string,
  nodeEnv = env.NODE_ENV,
  configuredEmails = env.ALLOWED_EMAILS,
  configuredAdmins = env.ADMIN_EMAILS,
): boolean {
  if (nodeEnv !== "production") return true;
  const allowed = new Set(configuredEmails.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  return allowed.has(email.trim().toLowerCase()) || isConfiguredAdminEmail(email, configuredAdmins);
}

/**
 * Production never grants admin to whoever signs up first. Outside production,
 * first-user bootstrap remains available for local development and tests.
 */
export function roleForNewUser(
  email: string,
  existingUsers: number,
  nodeEnv = env.NODE_ENV,
  configuredAdmins = env.ADMIN_EMAILS,
): "admin" | "user" {
  if (isConfiguredAdminEmail(email, configuredAdmins)) return "admin";
  if (nodeEnv !== "production" && existingUsers === 0) return "admin";
  return "user";
}

/**
 * Consumes a token. The `usedAt is null` guard is inside the WHERE clause, so
 * two simultaneous clicks cannot both succeed — the second update matches zero
 * rows.
 */
export async function consumeMagicLink(token: string): Promise<Verified> {
  const now = new Date();

  const claimed = await db
    .update(magicLinks)
    .set({ usedAt: now })
    .where(
      and(
        eq(magicLinks.tokenHash, hashToken(token)),
        isNull(magicLinks.usedAt),
        gt(magicLinks.expiresAt, now),
      ),
    )
    .returning({ email: magicLinks.email });

  const claim = claimed[0];
  if (!claim) {
    throw new LinkError("Link sudah dipakai atau kedaluwarsa", 410);
  }
  if (!isAllowedLoginEmail(claim.email)) {
    throw new LinkError("Akun ini tidak diizinkan masuk ke deployment ini", 403);
  }

  const existing = await db.select().from(users).where(eq(users.email, claim.email)).limit(1);
  const found = existing[0];

  if (found) {
    // Production administrator privileges follow the explicit allowlist both
    // ways: adding an address promotes it, removing one demotes it.
    if (env.NODE_ENV === "production" && found.role === "admin" && !isConfiguredAdminEmail(found.email)) {
      const [demoted] = await db
        .update(users)
        .set({ role: "user", updatedAt: new Date() })
        .where(eq(users.id, found.id))
        .returning();
      if (demoted) {
        return {
          userId: demoted.id,
          email: demoted.email,
          name: demoted.name,
          role: demoted.role,
        };
      }
    }
    if (found.role !== "admin" && isConfiguredAdminEmail(found.email)) {
      const [promoted] = await db
        .update(users)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(users.id, found.id))
        .returning();
      if (promoted) {
        return {
          userId: promoted.id,
          email: promoted.email,
          name: promoted.name,
          role: promoted.role,
        };
      }
    }
    return {
      userId: found.id,
      email: found.email,
      name: found.name,
      role: found.role,
    };
  }

  // First sign-in for this address. First-user admin bootstrap is limited
  // to development/tests; production requires an explicit administrator allowlist.
  const { count } = await db
    .select({ count: users.id })
    .from(users)
    .then((rows) => ({ count: rows.length }));

  const [created] = await db
    .insert(users)
    .values({
      email: claim.email,
      name: nameFromEmail(claim.email),
      role: roleForNewUser(claim.email, count, env.NODE_ENV, env.ADMIN_EMAILS),
    })
    .returning();

  return {
    userId: created!.id,
    email: created!.email,
    name: created!.name,
    role: created!.role,
  };
}

/** Housekeeping. */
export async function pruneMagicLinks(): Promise<number> {
  const dropped = await db
    .delete(magicLinks)
    .where(lt(magicLinks.expiresAt, new Date(Date.now() - 86_400_000)))
    .returning({ id: magicLinks.id });
  return dropped.length;
}
