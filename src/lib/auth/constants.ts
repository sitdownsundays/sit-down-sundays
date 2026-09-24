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
 * Sanitize a caller-supplied return path.
 *
 * Rejects external URLs, protocol-relative URLs, open redirects, and any
 * path outside the internal allow-list. Returns a safe default otherwise.
 */
export function sanitizeReturnPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return DEFAULT_POST_SIGNIN_PATH;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_POST_SIGNIN_PATH;
  // Must start with a single slash (no "//" protocol-relative, no scheme).
  if (!trimmed.startsWith("/")) return DEFAULT_POST_SIGNIN_PATH;
  if (trimmed.startsWith("//")) return DEFAULT_POST_SIGNIN_PATH;
  // Reject backslashes and control characters (eslint-disable for the char class).
  // eslint-disable-next-line no-control-regex
  if (/[\\]/.test(trimmed) || /[\x00-\x1f]/.test(trimmed)) return DEFAULT_POST_SIGNIN_PATH;
  // Must be within an allowed internal prefix.
  const allowed = ALLOWED_RETURN_PREFIXES.some((p) => trimmed === p || trimmed.startsWith(p + "/"));
  return allowed ? trimmed : DEFAULT_POST_SIGNIN_PATH;
}

/** Email/password validation boundaries (mirrors Supabase defaults). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 80;
