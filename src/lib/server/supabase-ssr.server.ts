/**
 * SERVER-ONLY — @supabase/ssr server client for TanStack Start.
 *
 * A per-request Supabase client that reads/writes auth + PKCE cookies through
 * the TanStack Start cookie adapter. Used for all user-facing auth flows:
 * signup, signin, callback exchange, forgot/reset, session resolution.
 *
 * Identity is verified server-side via `auth.getUser()` — never by trusting
 * decoded cookie contents or `getSession()` alone.
 *
 * SECURITY:
 *  - Uses SUPABASE_URL + SUPABASE_ANON_KEY (RLS applies). No service-role key.
 *  - Never imported into client modules (blocked by *.server.ts filename).
 *  - The client is created per-call so it binds to the current request's
 *    cookies and response headers.
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "./env.server";
import { createTanStackCookieAdapter } from "./supabase-cookies.server";

/**
 * Create a per-request @supabase/ssr server client bound to the current
 * TanStack Start request/response. PKCE + session cookies flow through the
 * adapter, so refreshes and verifier persistence are handled automatically.
 */
export function getSupabaseSSRClient(): SupabaseClient {
  const env = requireSupabaseEnv();
  const adapter = createTanStackCookieAdapter();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: adapter.getAll,
      setAll: adapter.setAll,
    },
    auth: {
      // PKCE flow — verifier is stored in a cookie by @supabase/ssr.
      flowType: "pkce",
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  });
}
