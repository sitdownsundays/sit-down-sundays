/**
 * Capacity-backed public read. All results are estimates, never holds.
 * No writes, activation, expiry, or payment operations occur here.
 */
import { buildEligibleOptions } from "./reservation-eligibility.server";
import { isValidTimezone, seatingStartISO } from "@/lib/reservation/timezone";
import { availableCapacity } from "./capacity-helpers.server";
import { getAdminClient } from "./supabase-admin.server";
import { resolveDataMode } from "./env.server";
import {
  readCapacityControl,
  readCapacityResources,
  readCapacityHolds,
  readCapacitySchedule,
} from "./capacity-availability-data.server";
import type { CapacityHoldInput } from "./capacity-helpers.server";
import type { CapacityAvailabilityResult } from "@/lib/reservation/capacity-availability";

const SAFE_ERROR = "Availability is temporarily unavailable. Please try again.";
const DISABLED = "Online reservations are not available yet. Please contact our team.";

export async function buildCapacityAvailability(): Promise<CapacityAvailabilityResult> {
  try {
    // Validate before repository selectors, which otherwise can fall back to
    // mock when env configuration is missing. Mock mode never invents seats.
    if (resolveDataMode().dataMode === "mock") {
      return { ok: false, readiness: "disabled", error: DISABLED };
    }
    const client = getAdminClient();
    const before = await readCapacityControl(client);
    if (!before.ready) return { ok: false, readiness: "disabled", error: DISABLED };

    const [{ services, spaces, policy, seatingsByService }, resources] = await Promise.all([
      readCapacitySchedule(client),
      readCapacityResources(client),
    ]);
    if (!policy.restaurantTimezone || !isValidTimezone(policy.restaurantTimezone)) {
      throw new Error("Restaurant timezone is not configured.");
    }
    const now = new Date();
    const eligible = buildEligibleOptions(services, seatingsByService, spaces, policy, now);
    const intervals = eligible.map((option) => {
      const service = services.find((row) => row.id === option.sundayService.id);
      const mapped = [...resources.values()].find((row) => row.space_id === service?.spaceId);
      const resource = resources.get(service?.capacityResourceId ?? mapped?.id ?? "");
      // Match capacity_resource_for_service_0019: default space mapping, or
      // an explicit override to that section's own whole-room parent only.
      if (
        !service ||
        !mapped?.is_active ||
        !resource?.is_active ||
        (resource.id !== mapped.id &&
          !(resource.resource_type === "whole" && mapped.parent_id === resource.id))
      ) {
        throw new Error("Capacity room mapping is not configured.");
      }
      const start = seatingStartISO(
        service.date,
        option.seatingTime.startTime,
        policy.restaurantTimezone,
      );
      const end = seatingStartISO(
        service.date,
        option.seatingTime.endTime,
        policy.restaurantTimezone,
      );
      if (
        !start ||
        !end ||
        Date.parse(end) <= Date.parse(start) ||
        !Number.isSafeInteger(option.configuredRequestCeiling) ||
        option.configuredRequestCeiling <= 0
      ) {
        throw new Error("Invalid booking interval or request limit.");
      }
      return { option, resource, start: Date.parse(start), end: Date.parse(end) };
    });
    const rows = intervals.length
      ? await readCapacityHolds(
          client,
          new Date(Math.min(...intervals.map((row) => row.start))).toISOString(),
          new Date(Math.max(...intervals.map((row) => row.end))).toISOString(),
        )
      : [];
    const holds: CapacityHoldInput[] = rows.map((row) => {
      if (!resources.has(row.capacity_resource_id)) throw new Error("Hold resource is missing.");
      return {
        capacityResourceId: row.capacity_resource_id,
        partySize: row.party_size,
        seatingStart: Date.parse(row.seating_start),
        seatingEnd: Date.parse(row.seating_end),
        state: row.state,
        holdDeadline: null, // Never infer release from a deadline.
      };
    });
    const calculationResources = new Map(
      [...resources.values()].map((row) => [
        row.id,
        { id: row.id, parentId: row.parent_id, totalCapacity: row.total_capacity },
      ]),
    );
    const options = intervals.map(({ option, resource, start, end }) => {
      const remaining = availableCapacity(
        { id: resource.id, parentId: resource.parent_id, totalCapacity: resource.total_capacity },
        calculationResources,
        holds,
        start,
        end,
        now.getTime(),
      );
      return {
        ...option,
        availableCapacity: remaining,
        maxBookablePartySize: Math.min(option.configuredRequestCeiling, remaining),
      };
    });
    const after = await readCapacityControl(client);
    // 0019 increments this revision in the same transaction as capacity and
    // protected config changes. Never publish a mixed, paginated snapshot.
    if (!after.ready || after.revision !== before.revision)
      throw new Error("Capacity changed during read.");
    return { ok: true, readiness: "enabled", options };
  } catch {
    return { ok: false, readiness: "error", error: SAFE_ERROR };
  }
}
