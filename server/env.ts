// Environment, read once at boot and validated.
//
// The server refuses to start on a bad config rather than failing later on the
// first request. Nothing here has a default that would silently point at
// someone else's database.

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
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
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

export const env = {
  NODE_ENV: optional("NODE_ENV", "development") as
    | "development"
    | "production"
    | "test",
  PORT: int("PORT", 8787),

  DATABASE_URL: required("DATABASE_URL", "postgres://lolo:lolo@localhost:5432/lolo"),

  /** Public origin, used to build magic links and the OpenAI-compatible base URL. */
  APP_URL: optional("APP_URL", `http://localhost:${int("PORT", 8787)}`),

  /** Where the built frontend lives. */
  STATIC_DIR: optional("STATIC_DIR", "dist"),

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
} as const;

export const isProd = env.NODE_ENV === "production";
