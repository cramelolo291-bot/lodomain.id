// A fixed-window rate limiter.
//
// In-process on purpose. A single operator's server does not justify Redis, and
// when it does grow past one box this swaps for a shared store without the
// call sites changing — the middleware signature is the same either way.

import type { Context, MiddlewareHandler } from "hono";
import { env } from "../env";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Trusted proxy hops, empty when the server is exposed directly. */
const TRUSTED_PROXIES = new Set(
  env.TRUST_PROXY.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const TRUST_ALL = env.TRUST_PROXY === "*" || env.TRUST_PROXY.toLowerCase() === "true";

/**
 * The address the socket actually came from.
 *
 * `c.env` is the Node `IncomingMessage` under @hono/node-server. When it is
 * missing (tests, a different adapter) the result is `undefined` and the caller
 * falls back to a shared key rather than trusting a header.
 */
function peerAddress(c: Context): string | undefined {
  const env_ = c.env as { socket?: { remoteAddress?: string } } | undefined;
  return env_?.socket?.remoteAddress ?? undefined;
}

function isTrustedProxy(address: string | undefined): boolean {
  if (TRUST_ALL) return true;
  if (!address) return false;
  return TRUSTED_PROXIES.has(address);
}

/**
 * Identifies the caller.
 *
 * `x-forwarded-for` is client-controlled, so it is only read when the immediate
 * peer is a proxy we were told to trust. Without that check, anyone can rotate
 * a header and walk straight past every limit here.
 */
export function clientIp(c: Context): string {
  const peer = peerAddress(c);
  if (!isTrustedProxy(peer)) return peer ?? "unknown";

  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    peer ??
    "unknown"
  );
}

/**
 * Drops expired buckets, and if that was not enough, the oldest ones.
 *
 * Sweeping on a size trigger alone is not enough: a burst of unique clients can
 * add thousands of live buckets between two sweeps, so eviction is unconditional
 * once the map is over the cap.
 */
function evict(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size <= env.RATE_LIMIT_MAX_KEYS) return;

  // Map iteration is insertion order, so the front is the oldest. Drop a tenth
  // at a time rather than emptying it, which would let a flood reset every
  // limit in one go.
  let toDrop = Math.ceil(buckets.size / 10);
  for (const key of buckets.keys()) {
    if (toDrop-- <= 0) break;
    buckets.delete(key);
  }
}

/** Tracked bucket count. Exported so a test can assert the map stays bounded. */
export function bucketCount(): number {
  return buckets.size;
}

/** Drops all state. Between tests. */
export function resetBuckets(): void {
  buckets.clear();
}

export function rateLimit(opts: {
  limit: number;
  windowMs: number;
  /** Distinguishes limits on different routes that share a client. */
  scope?: string;
}): MiddlewareHandler {
  const scope = opts.scope ?? "default";

  return async (c: Context, next: Next) => {
    const now = Date.now();

    // Behind a proxy the key must be the authenticated identity, not an IP a
    // client can rotate. The suffix is enough to bucket a key without holding
    // the secret itself.
    const bearer = c.req.header("authorization");
    const key = bearer ? `${scope}:key:${bearer.slice(-12)}` : `${scope}:${clientIp(c)}`;

    if (buckets.size >= env.RATE_LIMIT_MAX_KEYS) evict(now);

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      c.header("X-RateLimit-Limit", String(opts.limit));
      c.header("X-RateLimit-Remaining", String(opts.limit - 1));
      return next();
    }

    bucket.count += 1;
    c.header("X-RateLimit-Limit", String(opts.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, opts.limit - bucket.count)));

    if (bucket.count > opts.limit) {
      const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retry));
      return c.json(
        {
          error: {
            message: `Rate limit exceeded. Try again in ${retry}s.`,
            type: "rate_limit_error",
          },
        },
        429,
      );
    }

    return next();
  };
}

type Next = Parameters<MiddlewareHandler>[1];

/**
 * Caps request bodies so a single POST cannot exhaust memory.
 *
 * `content-length` alone is not enough: it is absent for chunked requests and
 * can lie. So the declared size is treated as an early rejection only, and the
 * real enforcement counts bytes as the body is read. The consumed body is put
 * back so downstream handlers see it unchanged.
 */
export function bodyLimit(maxBytes: number): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const declared = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) {
      return c.json({ error: { message: "Request body too large" } }, 413);
    }

    if (c.req.method === "GET" || c.req.method === "HEAD") {
      return next();
    }

    if (!c.req.raw.body) return next();

    const reader = c.req.raw.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > maxBytes) {
        // Stop reading and drop the rest; nothing is buffered past the cap.
        await reader.cancel().catch(() => {});
        return c.json({ error: { message: "Request body too large" } }, 413);
      }
      if (value) chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    c.req.raw = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers: c.req.raw.headers,
      body: merged,
    });

    return next();
  };
}
