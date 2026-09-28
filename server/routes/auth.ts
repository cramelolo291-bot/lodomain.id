// Auth routes. Every response here is shaped to match what the frontend's
// `httpApi()` already expects, so switching VITE_API_MODE=http changes nothing
// above the transport layer.

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { LinkError, consumeMagicLink, requestMagicLink } from "../auth/magic-link";
import {
  attachSession,
  clearSessionCookie,
  createSession,
  destroySession,
  readSession,
} from "../auth/session";
import { env } from "../env";

export const auth = new Hono();

auth.post("/auth/magic-link", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  if (!body.email) {
    return c.json({ error: { message: "email is required" } }, 400);
  }

  try {
    await requestMagicLink(body.email);
  } catch (e) {
    if (e instanceof LinkError) {
      return c.json({ error: { message: e.message } }, e.status);
    }
    throw e;
  }

  // The response is identical whether or not the account exists, so this
  // endpoint cannot be used to enumerate users.
  return c.json({ ok: true });
});

auth.get("/auth/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: { message: "token is required" } }, 400);

  let verified;
  try {
    verified = await consumeMagicLink(token);
  } catch (e) {
    if (e instanceof LinkError) {
      return c.json({ error: { message: e.message } }, e.status);
    }
    throw e;
  }

  const { token: sessionToken, expiresAt } = await createSession(verified.userId);
  attachSession(c, sessionToken, expiresAt);

  return c.json({
    id: verified.userId,
    email: verified.email,
    name: verified.name,
    role: verified.role,
  });
});

auth.get("/me", async (c) => {
  const session = await readSession(c);
  if (!session) return c.json(null);
  return c.json({
    email: session.email,
    name: session.name,
    role: session.role,
  });
});

auth.post("/auth/logout", async (c) => {
  const token = getCookie(c, env.SESSION_COOKIE);
  if (token) await destroySession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
