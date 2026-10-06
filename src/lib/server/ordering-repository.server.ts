/**
 * SERVER-ONLY — ordering repository selector.
 *
 * Returns the mock repository in local mock mode, the Supabase repository in
 * production. Mock mode is never silently used in production (env.server.ts
 * enforces this).
 */
import { isSupabaseMode } from "./env.server";
import type { IOrderingRepository } from "./ordering-repository-interface.server";
import { MockOrderingRepository } from "./ordering-mock.server";
import { SupabaseOrderingRepository } from "./ordering-supabase.server";

let mockRepo: MockOrderingRepository | null = null;
let supabaseRepo: SupabaseOrderingRepository | null = null;

export function getOrderingRepository(): IOrderingRepository {
  if (isSupabaseMode()) {
    if (!supabaseRepo) supabaseRepo = new SupabaseOrderingRepository();
    return supabaseRepo;
  }
  if (!mockRepo) mockRepo = new MockOrderingRepository();
  return mockRepo;
}
