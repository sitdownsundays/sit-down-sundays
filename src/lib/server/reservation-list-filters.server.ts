/**
 * SERVER-ONLY — build repository list filters from the strict
 * listReservationsSchema parsed output.
 *
 * The listReservations createServerFn wrapper validates input with
 * listReservationsSchema (a strict object), then forwards a filter object to
 * the repository. Under exactOptionalPropertyTypes, each field is included only
 * when its value is not undefined — a parsed optional may carry an explicit
 * undefined that must not become a key on the repository filter object.
 *
 * Extracted from the wrapper so the forwarding behavior is directly testable
 * without the TanStack Start RPC runtime. The wrapper imports and calls this
 * helper; it does not reproduce the logic.
 */
import type { ListReservationsSchema } from "@/lib/reservation/schema";

export type ListReservationsFilters = {
  sundayServiceId?: string;
  seatingTimeId?: string;
  status?: string;
  search?: string;
};

/**
 * Map parsed list-reservations input into repository filters, omitting
 * undefined optionals while preserving every supplied value (including empty
 * strings, which are not valid here but would be forwarded verbatim).
 *
 * Does not mutate the input. The schema's strict mode rejects unknown fields.
 */
export function buildListReservationsFilters(
  parsed: ListReservationsSchema,
): ListReservationsFilters {
  const filters: ListReservationsFilters = {};
  if (parsed.sundayServiceId !== undefined) filters.sundayServiceId = parsed.sundayServiceId;
  if (parsed.seatingTimeId !== undefined) filters.seatingTimeId = parsed.seatingTimeId;
  if (parsed.status !== undefined) filters.status = parsed.status;
  if (parsed.search !== undefined) filters.search = parsed.search;
  return filters;
}
