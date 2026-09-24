/**
 * SERVER-ONLY — @supabase/ssr cookie adapter for TanStack Start.
 *
 * Replaces the custom base64url `sds_session` cookie. Supabase now manages
 * its own session + PKCE cookies through this adapter using the official
 * `@supabase/ssr` `createServerClient`.
 *
 * Uses the supported TanStack Start server utilities from
 * `@tanstack/react-start/server`:
 *  - `getCookies()` returns the current request cookies as a record.
 *  - `setCookie(name, value, options)` stages a Set-Cookie on the response.
 *  - `setResponseHeader(name, value)` applies extra headers (e.g. Cache-Control)
 *    that @supabase/ssr passes alongside cookie writes.
 *
 * SECURITY:
 *  - HttpOnly + Secure + SameSite=Lax are set by @supabase/ssr itself.
 *  - Access/refresh tokens live ONLY in Supabase-managed cookies; they are
 *    never read by browser JavaScript.
 *  - This module is blocked from the client bundle by filename (*.server.ts).
 */
import { getCookies, setCookie, setResponseHeader } from "@tanstack/react-start/server";

/** Cookie options as passed by @supabase/ssr (Partial<cookie.SerializeOptions>). */
export type SupabaseCookieOptions = Parameters<typeof setCookie>[2];

export interface SupabaseCookieAdapter {
  getAll: () => { name: string; value: string }[];
  setAll: (
    cookiesToSet: { name: string; value: string; options: SupabaseCookieOptions }[],
    headers?: Record<string, string>,
  ) => void;
}

/**
 * Build the getAll/setAll adapter for @supabase/ssr's createServerClient.
 *
 * `setAll` delegates each cookie to `setCookie()` so a single response can
 * rotate the session cookie AND set the PKCE verifier cookie without one
 * overwriting the other. Extra response headers (e.g.
 * `Cache-Control: private, no-store`) are applied via `setResponseHeader`.
 */
export function createTanStackCookieAdapter(): SupabaseCookieAdapter {
  return {
    getAll: () => Object.entries(getCookies()).map(([name, value]) => ({ name, value })),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value, options } of cookiesToSet) {
        setCookie(name, value, options);
      }
      if (headers) {
        for (const [name, value] of Object.entries(headers)) {
          setResponseHeader(name, value);
        }
      }
    },
  };
}
