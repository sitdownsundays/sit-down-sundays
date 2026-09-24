/**
 * SERVER-ONLY — session cookie handling.
 *
 * Reads and writes the HTTP-only session cookie. The cookie carries the
 * Supabase access + refresh tokens ONLY on the server; they are never exposed
 * to browser JavaScript (HttpOnly + Secure + SameSite=Lax).
 *
 * Blocked from the client bundle by filename (*.server.ts).
 */
import { getCookies } from "@tanstack/react-start/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

/** The serialized session payload stored in the cookie (opaque to client). */
export interface SessionCookieValue {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
}

/**
 * Build a Set-Cookie header value that stores the session. The value is
 * base64url-encoded JSON of the tokens. `Secure` is added in production.
 */
export function buildSessionCookie(value: SessionCookieValue, isProduction: boolean): string {
  const payload = encodeSession(value);
  const secure = isProduction ? "; Secure" : "";
  return `sds_session=${payload}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

/** Build a Set-Cookie header value that clears the session. */
export function buildClearSessionCookie(isProduction: boolean): string {
  const secure = isProduction ? "; Secure" : "";
  return `sds_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function encodeSession(value: SessionCookieValue): string {
  const json = JSON.stringify(value);
  // base64url encode (Web-safe, no padding issues with = in cookies).
  const b64 = Buffer.from(json, "utf-8").toString("base64url");
  return b64;
}

function decodeSession(raw: string): SessionCookieValue | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as Partial<SessionCookieValue>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Read the mock-mode session cookie from the current request. Returns null
 * when absent or malformed. Never throws.
 *
 * Note: this is used ONLY by the mock auth repository for local development.
 * In Supabase mode, @supabase/ssr manages its own cookies through the adapter.
 */
export function readSessionCookie(): SessionCookieValue | null {
  try {
    const cookies = getCookies();
    const raw = cookies[SESSION_COOKIE_NAME];
    if (!raw) return null;
    return decodeSession(raw);
  } catch {
    return null;
  }
}

/** Whether the stored session's access token has expired. */
export function isSessionExpired(session: SessionCookieValue): boolean {
  try {
    return new Date(session.expiresAt).getTime() <= Date.now();
  } catch {
    return true;
  }
}
