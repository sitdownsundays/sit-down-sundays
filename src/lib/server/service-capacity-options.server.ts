/**
 * SERVER-ONLY — capacity-resource options for a Sunday service's selected room.
 *
 * Authorization precedes database access. Returns only valid capacity choices
 * for the given venue space: the default mapped resource, and — when the
 * mapped resource is a section — its own active whole-room parent.
 *
 * No raw database text is exposed. Missing or inactive mappings fail safely.
 */
import { z } from "zod";
import { resolveSundaysActor } from "./sundays-auth.server";
import { getAdminClient } from "./supabase-admin.server";
import { readCapacityResources } from "./capacity-availability-data.server";
import type {
  ServiceCapacityOption,
  ServiceCapacityOptionsResult,
} from "@/lib/sundays/service-capacity-options";

const inputSchema = z
  .object({
    spaceId: z.string().uuid(),
  })
  .strict();

export async function serverListServiceCapacityOptions(
  rawInput: unknown,
): Promise<ServiceCapacityOptionsResult> {
  try {
    // Requires availability.manage; authorization precedes database access.
    await resolveSundaysActor();
  } catch {
    return {
      ok: false,
      error: "You are not authorized to manage Sunday services.",
    };
  }

  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Invalid room selection." };
  }

  try {
    const resources = await readCapacityResources(getAdminClient());
    const mapped = [...resources.values()].find(
      (resource) => resource.space_id === parsed.data.spaceId,
    );

    if (!mapped || !mapped.is_active) {
      return {
        ok: false,
        error: "This room does not have an active capacity mapping.",
      };
    }

    const options: ServiceCapacityOption[] = [
      {
        capacityResourceId: null,
        mode: "default",
        totalCapacity: mapped.total_capacity,
      },
    ];

    if (mapped.resource_type === "section") {
      const parent = mapped.parent_id ? resources.get(mapped.parent_id) : undefined;

      if (
        !parent ||
        !parent.is_active ||
        parent.resource_type !== "whole" ||
        parent.parent_id !== null
      ) {
        return {
          ok: false,
          error: "This room's capacity configuration could not be verified.",
        };
      }

      options.push({
        capacityResourceId: parent.id,
        mode: "whole",
        totalCapacity: parent.total_capacity,
      });
    }

    return { ok: true, options };
  } catch {
    return {
      ok: false,
      error: "Capacity options could not be loaded. Please try again.",
    };
  }
}
