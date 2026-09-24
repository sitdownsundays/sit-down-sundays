/**
 * SERVER-ONLY — administrative Supabase client (service-role).
 *
 * Created lazily from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Bypasses RLS.
 *
 * SECURITY:
 *  - Never imported into client modules (blocked by *.server.ts filename).
 *  - Never serialized or returned across the server-function RPC boundary.
 *  - Used ONLY when an operation genuinely requires elevated access.
 *  - Possession of this client is NOT authorization. Every elevated operation
 *    must perform explicit authorization before using it (future auth phase).
 *
 * No staff-management endpoints use this client during Phase 2A.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "./env.server";

let cached: SupabaseClient | null = null;

/** Lazily create (and cache) the administrative server client. */
export function getAdminClient(): SupabaseClient {
  if (cached) return cached;
  const env = requireSupabaseEnv();
  cached = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
