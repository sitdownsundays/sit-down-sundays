/**
 * Payment access token primitives — server-only.
 *
 * These helpers create and verify opaque authorization tokens. They do NOT
 * establish authorization by themselves: the caller must bind a token to a
 * specific reservation through an atomic, server-side operation and enforce
 * that binding. Tokens are never logged or included in errors.
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43; // base64url(32 bytes), unpadded
const HASH_HEX_LENGTH = 64; // SHA-256 lowercase hex

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const LOWER_HEX_64_RE = /^[0-9a-f]{64}$/;

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/**
 * Create a fresh opaque payment access token and its stored hash.
 *
 * The token is 32 cryptographically random bytes encoded as canonical,
 * unpadded base64url (exactly 43 characters). The hash is the lowercase
 * SHA-256 hex digest of the token string. Store only the hash; return the
 * raw token to the caller exactly once.
 */
export function createPaymentAccessToken(): { token: string; tokenHash: string } {
  const bytes = randomBytes(TOKEN_BYTES);
  const token = toBase64Url(bytes);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/**
 * Hash a payment access token, returning the lowercase SHA-256 hex digest
 * or null when the input is not a valid canonical token.
 *
 * Strictly rejects non-strings, wrong lengths, non-base64url characters, and
 * noncanonical encodings (decoded length must be exactly 32 bytes and the
 * re-encoded form must match the input) before hashing.
 */
export function hashPaymentAccessToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  if (token.length !== TOKEN_LENGTH) return null;
  if (!BASE64URL_RE.test(token)) return null;

  const decoded = Buffer.from(token, "base64url");
  if (decoded.length !== TOKEN_BYTES) return null;

  // Canonical check: re-encoding the decoded bytes must reproduce the input.
  if (toBase64Url(decoded) !== token) return null;

  return createHash("sha256").update(token).digest("hex");
}

/**
 * Verify a token against a stored hash using a constant-time comparison.
 *
 * The stored hash must be exactly 64 lowercase hex characters. Invalid token
 * or hash input returns false without leaking which side failed.
 */
export function matchesPaymentAccessToken(token: unknown, storedHash: unknown): boolean {
  const hash = hashPaymentAccessToken(token);
  if (hash === null) return false;

  if (typeof storedHash !== "string") return false;
  if (storedHash.length !== HASH_HEX_LENGTH) return false;
  if (!LOWER_HEX_64_RE.test(storedHash)) return false;

  // Both are 64-char hex strings → 64-byte buffers of equal length.
  return timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}
