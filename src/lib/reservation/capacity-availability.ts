import type { PublicAvailabilityOption } from "./types";

/** Advisory inventory only. The atomic submission RPC remains authoritative. */
export interface CapacityAvailabilityOption extends PublicAvailabilityOption {
  /** Physical seats remaining during the entire requested interval. */
  availableCapacity: number;
  /** Smaller of remaining physical capacity and configured online limits. */
  maxBookablePartySize: number;
}

export type CapacityAvailabilityResult =
  | { ok: true; readiness: "enabled"; options: CapacityAvailabilityOption[] }
  | { ok: false; readiness: "disabled"; error: string }
  | { ok: false; readiness: "error"; error: string };
