// Token hygiene.
//
// Every credential this server issues is stored as a SHA-256 digest. The
// plaintext exists exactly once, in the response that hands it to the client.
// A database dump therefore contains no usable session, magic link, or API key.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 bits of entropy, URL-safe. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * SHA-256 is right here and not bcrypt/argon because these are high-entropy
 * random values: there is no dictionary to attack, only guessing, and 256 bits
 * is unguessable. Passwords would need a slow KDF. These are not passwords.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare, so a lookup cannot be timed character by character. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** `sk-lolo-<random>` — recognisable in a list, useless without the secret. */
export function generateApiKey(): { secret: string; prefix: string; hash: string } {
  const secret = `sk-lolo-${randomBytes(24).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 12), hash: hashToken(secret) };
}

export function verifyApiKey(secret: string, hash: string): boolean {
  return safeEqual(hashToken(secret), hash);
}
