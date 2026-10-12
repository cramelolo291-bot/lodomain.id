// Sessions: a hashed token in an httpOnly cookie, a row in `sessions`.
//
// The raw token is never written to the database. Signing out deletes the row,
// which invalidates the cookie everywhere it was copied — there is no server
// state to keep in sync.

import { and, eq, gt, lt } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { setCookie } from "hono/cookie";
import { db, type Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { env, isProd } from "../env";
import { generateToken, hashToken } from "./tokens";
import { isAllowedLoginEmail, isConfiguredAdminEmail } from "./magic-link";

export type Session = {
  userId: string;
  email: string;
  name: string;
  role: "admin" | "user";
  expiresAt: number;
};

/** Minimal cookie reader. One name, no decoding games, no dependency. */
function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Drops rows that have already expired. Cheap enough to run on boot. */
export async function pruneSessions(): Promise<number> {
  const dropped = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return dropped.length;
}

export function attachSession(c: Context, token: string, expiresAt: Date): void {
  setCookie(c, env.SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context): void {
  setCookie(c, env.SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

export async function readSession(c: Context): Promise<Session | null> {
  return sessionFromCookieHeader(c.req.header("cookie"));
}

/**
 * Same lookup, from a raw `Cookie` header.
 *
 * Needed for the WebSocket upgrade path, which never becomes a Hono context —
 * an upgrade is handled on the raw socket before routing. Without this, an
 * authenticated tunnel would be the one route in the app that skips the check.
 */
export async function sessionFromCookieHeader(
  header: string | undefined,
): Promise<Session | null> {
  const token = parseCookie(header, env.SESSION_COOKIE);
  if (!token) return null;

  const rows = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!isAllowedLoginEmail(row.email)) {
    // Remove the session so a later allowlist change cannot revive it.
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    return null;
  }
  if (env.NODE_ENV === "production" && row.role === "admin" && !isConfiguredAdminEmail(row.email)) {
    const [demoted] = await db
      .update(users)
      .set({ role: "user", updatedAt: new Date() })
      .where(eq(users.id, row.userId))
      .returning({ role: users.role });
    row.role = demoted?.role ?? "user";
  }

  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    expiresAt: row.expiresAt.getTime(),
  };
}

declare module "hono" {
  interface ContextVariableMap {
    session: Session;
  }
}

/** Rejects with 401 when there is no valid session. */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const session = await readSession(c);
  if (!session) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }
  c.set("session", session);
  await next();
};

/** For the server panel only. Admins see every account, not just their own. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (session.role !== "admin") {
    return c.json({ error: { message: "Admin access required" } }, 403);
  }
  await next();
};

export type { Db };
