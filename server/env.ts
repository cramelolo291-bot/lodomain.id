// Environment, read once at boot and validated.
//
// The server refuses to start on a bad config rather than failing later on the
// first request. Nothing here has a default that would silently point at
// someone else's database.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in — see README.md.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer, got "${raw}"`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive safe integer, got "${raw}"`);
  }
  if (name === "PORT" && n > 65_535) {
    throw new Error("PORT must be between 1 and 65535");
  }
  return n;
}

export const env = {
  NODE_ENV: (() => {
    const value = optional("NODE_ENV", "development");
    if (value !== "development" && value !== "production" && value !== "test") {
      throw new Error("NODE_ENV must be development, test, or production");
    }
    return value;
  })(),
  PORT: int("PORT", 8787),

  // Never silently connect to a predictable local credential in a deployed environment.
  DATABASE_URL: required("DATABASE_URL"),

  /** Public origin, used to build magic links and the OpenAI-compatible base URL. */
  APP_URL: optional("APP_URL", `http://localhost:${int("PORT", 8787)}`),

  /** Where the built frontend lives. */
  STATIC_DIR: optional("STATIC_DIR", "dist"),

  /** Comma-separated email allowlist for production admin access. */
  ADMIN_EMAILS: optional("ADMIN_EMAILS", ""),
  /** Comma-separated exact email allowlist for production sign-in. */
  ALLOWED_EMAILS: optional("ALLOWED_EMAILS", ""),
  SESSION_COOKIE: optional("SESSION_COOKIE", "lolo_session"),
  SESSION_TTL_HOURS: int("SESSION_TTL_HOURS", 30 * 24),
  MAGIC_LINK_TTL_MINUTES: int("MAGIC_LINK_TTL_MINUTES", 15),

  /** Resend. Without it, magic links are printed to the log instead of sent. */
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
  MAIL_FROM: optional("MAIL_FROM", "Lolo <onboarding@resend.dev>"),

  /** Ollama on the machine running this server. */
  OLLAMA_URL: optional("OLLAMA_URL", "http://127.0.0.1:11434"),
  OLLAMA_TIMEOUT_MS: int("OLLAMA_TIMEOUT_MS", 120_000),
  OLLAMA_KEEPALIVE_MS: int("OLLAMA_KEEPALIVE_MS", 45_000),

  /** Scheduler. */
  COOLDOWN_MS: int("COOLDOWN_MS", 30_000),
  MAX_ATTEMPTS: int("MAX_ATTEMPTS", 3),
  API_RATE_LIMIT: int("API_RATE_LIMIT", 600),
  API_RATE_WINDOW_MS: int("API_RATE_WINDOW_MS", 60_000),

  /**
   * Whether to believe `x-forwarded-for`. Off by default, and it must stay off
   * unless a reverse proxy you control sits in front: the header is set by the
   * client, so trusting it hands every rate limiter a spoofable identity.
   * Set to a comma-separated allowlist of proxy IPs to trust only those hops.
   */
  TRUST_PROXY: optional("TRUST_PROXY", ""),
  /** Hard cap on tracked rate-limit buckets, so the map cannot grow forever. */
  RATE_LIMIT_MAX_KEYS: int("RATE_LIMIT_MAX_KEYS", 20_000),
  /** debug | info | warn | error. Below info hides per-request lines. */
  LOG_LEVEL: optional("LOG_LEVEL", "") as "debug" | "info" | "warn" | "error" | "",
} as const;

export const isProd = env.NODE_ENV === "production";
