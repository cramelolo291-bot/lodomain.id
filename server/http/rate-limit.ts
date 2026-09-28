// A fixed-window rate limiter.
//
// In-process on purpose. A single operator's server does not justify Redis, and
// when it does grow past one box this swaps for a shared store without the
// call sites changing — the middleware signature is the same either way.

import type { Context, MiddlewareHandler } from "hono";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Keep the map from growing without bound on a long-lived process.
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(opts: {
  limit: number;
  windowMs: number;
  /** Distinguishes limits on different routes that share a client. */
  scope?: string;
}): MiddlewareHandler {
  const scope = opts.scope ?? "default";

  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-real-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "local";

    const now = Date.now();
    const key = `${scope}:${ip}`;

    // Behind a proxy the key must be the authenticated identity, not an IP a
    // client can rotate.
    const bearer = c.req.header("authorization");
    const actual = bearer ? `${scope}:key:${bearer.slice(-12)}` : key;

    const bucket = buckets.get(actual);
    if (!bucket || bucket.resetAt <= now) {
      sweep(now);
      buckets.set(actual, { count: 1, resetAt: now + opts.windowMs });
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

/** Caps request bodies so a single POST cannot exhaust memory. */
export function bodyLimit(bytes: number): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const length = Number(c.req.header("content-length") ?? "0");
    if (length > bytes) {
      return c.json({ error: { message: "Request body too large" } }, 413);
    }
    return next();
  };
}
