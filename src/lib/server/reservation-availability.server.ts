/**
 * SERVER-ONLY — shared public-availability builder.
 *
 * Thin wrapper around the shared eligibility helper
 * (reservation-eligibility.server.ts) so the public availability list and the
 * reservation submission path use identical filtering rules.
 *
 * This is REQUEST availability, NOT measured live inventory. The configured
 * ceiling is surfaced, not remaining capacity. Real-time capacity enforcement
 * against existing reservations is a future phase. Overlapping seating starts
 * are NOT independent room capacity pools.
 */
import { getSundaysRepository } from "./sundays-repository.server";
import { getSpaceRepository } from "./space-repository.server";
import { buildEligibleOptions } from "./reservation-eligibility.server";
import type { PublicAvailabilityOption } from "@/lib/reservation/types";

/**
 * Build the sanitized public availability list. Returns options that are
 * configured and requestable. This is REQUEST availability, NOT measured live
 * inventory — the configured ceiling is surfaced, not remaining capacity.
 */
export async function buildPublicAvailability(): Promise<PublicAvailabilityOption[]> {
  const sundays = getSundaysRepository();
  const spaces = getSpaceRepository();

  const [services, allSpaces, policy] = await Promise.all([
    sundays.listAllSundayServices(),
    spaces.listAllSpaces(),
    sundays.getPaymentPolicy(),
  ]);

  // Fetch seatings per service so the shared helper stays pure.
  const seatingsByService = new Map<
    string,
    Awaited<ReturnType<typeof sundays.listSeatingTimesForService>>
  >();
  await Promise.all(
    services.map(async (svc) => {
      seatingsByService.set(svc.id, await sundays.listSeatingTimesForService(svc.id));
    }),
  );

  return buildEligibleOptions(services, seatingsByService, allSpaces, policy);
}
