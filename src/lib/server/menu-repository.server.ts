/**
 * Menu CMS — repository dispatch (server-only).
 *
 * Returns the active repository based on APP_DATA_MODE. Browser code never
 * imports this module and never chooses the data mode.
 */
import { resolveDataMode } from "./env.server";
import { MockMenuRepository } from "./menu-mock.server";
import { SupabaseMenuRepository } from "./menu-supabase.server";
import type { MenuRepository } from "./menu-shared.server";

let mockInstance: MockMenuRepository | null = null;

/** Test-only: reset the mock menu repository's in-memory state. */
export function __resetMockMenuRepository(): void {
  mockInstance = null;
}

/** Test-only: access the mock instance for seeding. Throws in Supabase mode. */
export function __getMockMenuRepositoryForSeed(): MockMenuRepository {
  const { dataMode } = resolveDataMode();
  if (dataMode !== "mock") throw new Error("Mock menu repository is only available in mock mode.");
  if (!mockInstance) mockInstance = new MockMenuRepository();
  return mockInstance;
}

export function getMenuRepository(): MenuRepository {
  const { dataMode } = resolveDataMode();
  if (dataMode === "mock") {
    if (!mockInstance) mockInstance = new MockMenuRepository();
    return mockInstance;
  }
  return new SupabaseMenuRepository();
}

export type { MenuRepository };
