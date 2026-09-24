/**
 * SERVER-ONLY — anonymous Supabase client.
 *
 * Created lazily from SUPABASE_URL + SUPABASE_ANON_KEY. Supports future
 * RLS-constrained operations. Never exposed to browser components.
 * Never carries the service-role key.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "./env.server";

let cached: SupabaseClient | null = null;

/** Lazily create (and cache) the anonymous server client. */
export function getAnonClient(): SupabaseClient {
  if (cached) return cached;
  const env = requireSupabaseEnv();
  cached = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
