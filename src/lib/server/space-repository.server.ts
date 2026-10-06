import { isSupabaseMode } from "./env.server";
import type { ISpaceRepository } from "./space-repository-interface.server";
import { MockSpaceRepository } from "./space-mock.server";
import { SupabaseSpaceRepository } from "./space-supabase.server";

let mockRepo: MockSpaceRepository | null = null;
let supabaseRepo: SupabaseSpaceRepository | null = null;

export function getSpaceRepository(): ISpaceRepository {
  if (isSupabaseMode()) {
    if (!supabaseRepo) supabaseRepo = new SupabaseSpaceRepository();
    return supabaseRepo;
  }
  if (!mockRepo) mockRepo = new MockSpaceRepository();
  return mockRepo;
}
