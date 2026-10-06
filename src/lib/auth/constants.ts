/**
 * Client-safe authentication constants.
 *
 * Cookie name, redirect allow-list helpers, and validation boundaries.
 * No secrets. The cookie NAME is public; only its VALUE (the session) is
 * protected by HttpOnly + Secure + SameSite.
 */

/** Name of the HTTP-only session cookie. The name is not secret. */
export const SESSION_COOKIE_NAME = "sds_session";

/** Default path a guest lands on after signing in. */
export const DEFAULT_POST_SIGNIN_PATH = "/account";

/** Path a suspended/archived user is sent to. */
export const ACCOUNT_BLOCKED_PATH = "/sign-in";

/** Allowed internal return-path prefixes after sign-in. */
export const ALLOWED_RETURN_PREFIXES = ["/account", "/staff", "/kitchen", "/admin"] as const;

/**
 * Whether a caller-supplied return path is a valid internal path.
 *
 * Rejects external URLs, protocol-relative URLs, open redirects, backslashes,
 * control characters, and any path outside the internal allow-list. Shared by
 * sanitizeReturnPath and the permission-aware destination resolver so both
 * use one validation rule.
 */
export function isAllowedReturnPath(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // Must start with a single slash (no "//" protocol-relative, no scheme).
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  // Reject backslashes and control characters.
  // eslint-disable-next-line no-control-regex
  if (/[\\]/.test(trimmed) || /[\x00-\x1f]/.test(trimmed)) return false;
  // Must be within an allowed internal prefix.
  return ALLOWED_RETURN_PREFIXES.some((p) => trimmed === p || trimmed.startsWith(p + "/"));
}

/**
 * Sanitize a caller-supplied return path.
 *
 * Rejects external URLs, protocol-relative URLs, open redirects, and any
 * path outside the internal allow-list. Returns a safe default otherwise.
 */
export function sanitizeReturnPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return DEFAULT_POST_SIGNIN_PATH;
  return isAllowedReturnPath(raw) ? raw.trim() : DEFAULT_POST_SIGNIN_PATH;
}

/** Email/password validation boundaries (mirrors Supabase defaults). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 80;
