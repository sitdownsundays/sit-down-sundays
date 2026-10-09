/**
 * SERVER-ONLY — reservation repository selector.
 *
 * Returns the mock repository in explicit local mock mode, or the Supabase
 * repository in Supabase mode. The server decides the data mode; browser code
 * never chooses independently. Production never silently falls back to mock.
 */
import { isMockMode } from "./env.server";
import type { IReservationRepository } from "./reservation-repository-interface.server";
import { MockReservationRepository } from "./reservation-mock.server";
import { SupabaseReservationRepository } from "./reservation-supabase.server";

let cached: IReservationRepository | null = null;

export function getReservationRepository(): IReservationRepository {
  if (cached) return cached;
  cached = isMockMode() ? new MockReservationRepository() : new SupabaseReservationRepository();
  return cached;
}
