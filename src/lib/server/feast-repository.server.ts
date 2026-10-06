import { isSupabaseMode } from "./env.server";
import type { IFeastRepository } from "./feast-repository-interface.server";
import { MockFeastRepository } from "./feast-mock.server";
import { SupabaseFeastRepository } from "./feast-supabase.server";

let mockRepo: MockFeastRepository | null = null;
let supabaseRepo: SupabaseFeastRepository | null = null;

export function getFeastRepository(): IFeastRepository {
  if (isSupabaseMode()) {
    if (!supabaseRepo) supabaseRepo = new SupabaseFeastRepository();
    return supabaseRepo;
  }
  if (!mockRepo) mockRepo = new MockFeastRepository();
  return mockRepo;
}
