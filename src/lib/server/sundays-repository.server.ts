/**
 * SERVER-ONLY — Sundays & Seating repository selector.
 *
 * Returns the mock repository in local development (APP_DATA_MODE=mock) and
 * the Supabase repository in production. Production never silently falls
 * back to mock mode (env.server rejects mock in production).
 */
import { isSupabaseMode } from "./env.server";
import type { ISundaysRepository } from "./sundays-repository-interface.server";
import { MockSundaysRepository } from "./sundays-mock.server";
import { SupabaseSundaysRepository } from "./sundays-supabase.server";

let mockRepo: MockSundaysRepository | null = null;
let supabaseRepo: SupabaseSundaysRepository | null = null;

export function getSundaysRepository(): ISundaysRepository {
  if (isSupabaseMode()) {
    if (!supabaseRepo) supabaseRepo = new SupabaseSundaysRepository();
    return supabaseRepo;
  }
  if (!mockRepo) mockRepo = new MockSundaysRepository();
  return mockRepo;
}
