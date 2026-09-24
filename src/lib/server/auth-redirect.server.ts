/**
 * SERVER-ONLY — auth email-redirect URL helpers.
 *
 * Supabase Auth sends two distinct PKCE email flows, each with its own
 * destination on our site:
 *
 *  - New-account email confirmation → /auth/callback
 *  - Password-recovery email link    → /reset-password
 *
 * `/forgot-password` only DISPLAYS the request-a-reset form; it is never the
 * destination of the emailed recovery link.
 *
 * These helpers normalize SUPABASE_SITE_URL (stripping trailing slashes) and
 * append the correct path so production URLs are exactly:
 *
 *   https://sitdownsundays.net/auth/callback
 *   https://sitdownsundays.net/reset-password
 *
 * Blocked from the client bundle by filename (*.server.ts). Never returns
 * secrets — only the public site URL + a known path.
 */
import { requireSupabaseEnv } from "./env.server";

/** Path appended after new-account email confirmation. */
export const ACCOUNT_CONFIRMATION_PATH = "/auth/callback";
/** Path appended after a password-recovery email link. */
export const PASSWORD_RECOVERY_PATH = "/reset-password";

/**
 * Normalize the configured site URL: strip trailing slashes so appending a
 * leading-slash path never produces a double slash.
 */
function normalizeSiteUrl(raw: string | undefined): string {
  if (!raw) {
    // Fall back to a sane default when SUPABASE_SITE_URL is unset. In
    // production this should always be configured; requireSupabaseEnv still
    // succeeds without it, so we use a safe default rather than throw.
    return "https://sitdownsundays.net";
  }
  return raw.replace(/\/+$/, "");
}

/**
 * The destination Supabase redirects to after a new user clicks the
 * email-confirmation link. This is the /auth/callback route, which exchanges
 * the PKCE code and establishes a session.
 */
export function accountConfirmationUrl(): string {
  const { siteUrl } = requireSupabaseEnv();
  return `${normalizeSiteUrl(siteUrl)}${ACCOUNT_CONFIRMATION_PATH}`;
}

/**
 * The destination Supabase redirects to after a user clicks the
 * password-recovery email link. This is the /reset-password route, which
 * exchanges the PKCE recovery code and presents the new-password form.
 */
export function passwordRecoveryUrl(): string {
  const { siteUrl } = requireSupabaseEnv();
  return `${normalizeSiteUrl(siteUrl)}${PASSWORD_RECOVERY_PATH}`;
}
