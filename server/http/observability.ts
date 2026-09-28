// Observability.
//
// Two things every production server needs and neither ships by default: a way
// to tie a log line to a request, and a way to read a log at 3am. This provides
// both — a request id that travels in a header and appears in every line, and
// JSON output that a log shipper can parse without a regex.
//
// Logs are JSON in production and readable lines in development, because a human
// reading a terminal and a machine reading a file want different things.

import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import { env, isProd } from "../env";

export type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
// An unrecognised LOG_LEVEL falls back to the default rather than silencing
// every line, because a typo in a deploy is not a reason to lose the logs.
const configured = (env.LOG_LEVEL || (isProd ? "info" : "debug")) as Level;
const threshold = LEVELS[configured] ?? LEVELS[isProd ? "info" : "debug"];

/** Redacted so a password in a query string never reaches a log file. */
const SECRET_KEYS = /^(authorization|cookie|password|token|secret|api[_-]?key)$/i;

export type LogFields = Record<string, unknown>;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** A flat field bag with every secret-shaped value replaced. */
function scrub(fields: LogFields): LogFields {
  return redact(fields) as LogFields;
}

function emit(level: Level, message: string, fields: LogFields = {}) {
  if (LEVELS[level] < threshold) return;

  const safe = scrub(fields);
  const record = { level, message, time: new Date().toISOString(), ...safe };

  if (isProd) {
    // One object per line. A shipper can parse this without a regex.
    console.log(JSON.stringify(record));
    return;
  }

  const extra = Object.entries(safe)
    .filter(([k]) => k !== "requestId")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
  const id = fields.requestId ? ` [${String(fields.requestId).slice(0, 8)}]` : "";
  console.log(`${record.time} ${level.toUpperCase().padEnd(5)}${id} ${message}${extra ? ` ${extra}` : ""}`);
}

export const log = {
  debug: (m: string, f?: LogFields) => emit("debug", m, f),
  info: (m: string, f?: LogFields) => emit("info", m, f),
  warn: (m: string, f?: LogFields) => emit("warn", m, f),
  error: (m: string, f?: LogFields) => emit("error", m, f),
};

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    startedAt: number;
  }
}

/**
 * Assigns a request id and logs the outcome. The id comes from the client when
 * it sends one, so a trace spans the browser, the reverse proxy and here.
 */
export function requestContext(opts: { silent?: boolean } = {}): MiddlewareHandler {
  const silent = opts.silent ?? false;

  return async (c: Context, next: Next) => {
    const incoming = c.req.header("x-request-id");
    // Only trust an upstream id that looks like one; an arbitrary string would
    // end up in log output unescaped.
    const requestId =
      incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();

    c.set("requestId", requestId);
    c.set("startedAt", Date.now());
    c.header("x-request-id", requestId);

    const start = Date.now();
    if (silent) {
      await next();
      return;
    }
    try {
      await next();
    } finally {
      const ms = Date.now() - start;
      const status = c.res.status;
      // Slow requests are worth seeing even when they succeed.
      if (status >= 500) {
        log.error("request", { requestId, method: c.req.method, path: c.req.path, status, ms });
      } else if (status >= 400) {
        log.warn("request", { requestId, method: c.req.method, path: c.req.path, status, ms });
      } else if (ms > 2_000) {
        log.warn("slow request", { requestId, method: c.req.method, path: c.req.path, status, ms });
      } else {
        log.debug("request", { requestId, method: c.req.method, path: c.req.path, status, ms });
      }
    }
  };
}

/** Request-scoped logger, so handlers do not repeat the id. */
export function loggerFor(c: Context) {
  const requestId = c.get("requestId");
  return {
    info: (m: string, f: LogFields = {}) => log.info(m, { ...f, requestId }),
    warn: (m: string, f: LogFields = {}) => log.warn(m, { ...f, requestId }),
    error: (m: string, f: LogFields = {}) => log.error(m, { ...f, requestId }),
  };
}
