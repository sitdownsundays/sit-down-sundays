/**
 * SERVER-ONLY — Sundays & Seating server actions.
 *
 * Thin handlers: resolve the authorized actor (availability.manage), validate
 * input with the strict schemas, and delegate to the repository. No raw
 * Supabase errors reach the caller. Protected fields (id, audit, timestamps,
 * identity) are never accepted from the browser.
 */
import {
  createSundayServiceSchema,
  updateSundayServiceSchema,
  createSeatingTimeSchema,
  updateSeatingTimeSchema,
  updatePaymentPolicySchema,
  createDiningTableSchema,
  updateDiningTableSchema,
} from "@/lib/sundays/schema";
import { z } from "zod";
import { getSundaysRepository } from "./sundays-repository.server";
import { getSpaceRepository } from "./space-repository.server";
import {
  resolveSundaysActor,
  resolveSundaysActorWithPermission,
  SundaysAuthorizationError,
} from "./sundays-auth.server";
import type {
  SundayServiceDTO,
  SeatingTimeDTO,
  PaymentPolicyDTO,
  SundayServiceOperationResult,
  SeatingTimeOperationResult,
  PaymentPolicyOperationResult,
  DiningTableDTO,
  DiningTableListResult,
  DiningTableOperationResult,
  DiningTableRoomOptionsResult,
  DiningTableRoomOption,
} from "@/lib/sundays/types";

/** A neutral, secret-free error returned when the caller is not authorized. */
const UNAUTHORIZED_SERVICE: SundayServiceOperationResult = {
  success: false,
  error: "You are not authorized to perform this action.",
};
const UNAUTHORIZED_SEATING: SeatingTimeOperationResult = {
  success: false,
  error: "You are not authorized to perform this action.",
};
const UNAUTHORIZED_POLICY: PaymentPolicyOperationResult = {
  success: false,
  error: "You are not authorized to perform this action.",
};
const UNAUTHORIZED_TABLE: DiningTableOperationResult = {
  success: false,
  error: "You are not authorized to perform this action.",
};

// ---------------------------------------------------------------------------
// Sunday services
// ---------------------------------------------------------------------------

export async function serverListAllSundayServices(): Promise<SundayServiceDTO[]> {
  try {
    await resolveSundaysActor();
  } catch {
    return [];
  }
  const repo = getSundaysRepository();
  return await repo.listAllSundayServices();
}

export async function serverCreateSundayService(
  rawInput: unknown,
): Promise<SundayServiceOperationResult> {
  let actor;
  try {
    actor = await resolveSundaysActor();
  } catch {
    return UNAUTHORIZED_SERVICE;
  }
  try {
    const parsed = createSundayServiceSchema.parse(rawInput);
    const repo = getSundaysRepository();
    return await repo.createSundayService(actor.userId, parsed);
  } catch {
    return {
      success: false,
      error: "Could not create Sunday service. Check your entries and try again.",
    };
  }
}

export async function serverUpdateSundayService(
  rawInput: unknown,
): Promise<SundayServiceOperationResult> {
  let actor;
  try {
    actor = await resolveSundaysActor();
  } catch (e) {
    if (e instanceof SundaysAuthorizationError) return UNAUTHORIZED_SERVICE;
    return UNAUTHORIZED_SERVICE;
  }
  try {
    const parsed = updateSundayServiceSchema.parse(rawInput);
    const repo = getSundaysRepository();
    return await repo.updateSundayService(actor.userId, parsed);
  } catch {
    return {
      success: false,
      error: "Could not update Sunday service. Check your entries and try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Seating times
// ---------------------------------------------------------------------------

export async function serverListSeatingTimes(sundayServiceId: string): Promise<SeatingTimeDTO[]> {
  try {
    await resolveSundaysActor();
  } catch {
    return [];
  }
  const repo = getSundaysRepository();
  return await repo.listSeatingTimesForService(sundayServiceId);
}

export async function serverCreateSeatingTime(
  rawInput: unknown,
): Promise<SeatingTimeOperationResult> {
  let actor;
  try {
    actor = await resolveSundaysActor();
  } catch {
    return UNAUTHORIZED_SEATING;
  }
  try {
    const parsed = createSeatingTimeSchema.parse(rawInput);
    const repo = getSundaysRepository();
    return await repo.createSeatingTime(actor.userId, parsed);
  } catch {
    return {
      success: false,
      error: "Could not create seating time. Check your entries and try again.",
    };
  }
}

export async function serverUpdateSeatingTime(
  rawInput: unknown,
): Promise<SeatingTimeOperationResult> {
  let actor;
  try {
    actor = await resolveSundaysActor();
  } catch (e) {
    if (e instanceof SundaysAuthorizationError) return UNAUTHORIZED_SEATING;
    return UNAUTHORIZED_SEATING;
  }
  try {
    const parsed = updateSeatingTimeSchema.parse(rawInput);
    const repo = getSundaysRepository();
    return await repo.updateSeatingTime(actor.userId, parsed);
  } catch {
    return {
      success: false,
      error: "Could not update seating time. Check your entries and try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Payment policy (singleton)
// ---------------------------------------------------------------------------

export async function serverGetPaymentPolicy(): Promise<PaymentPolicyDTO> {
  try {
    await resolveSundaysActor();
  } catch {
    return {
      depositPercent: 50,
      defaultBalanceDeadlineHours: 72,
      restaurantTimezone: null,
      taxRateBasisPoints: null,
      gratuityRateBasisPoints: null,
      taxOnGratuity: null,
      updatedAt: "",
    };
  }
  const repo = getSundaysRepository();
  return await repo.getPaymentPolicy();
}

export async function serverUpdatePaymentPolicy(
  rawInput: unknown,
): Promise<PaymentPolicyOperationResult> {
  let actor;
  try {
    actor = await resolveSundaysActor();
  } catch {
    return UNAUTHORIZED_POLICY;
  }
  try {
    const parsed = updatePaymentPolicySchema.parse(rawInput);
    const repo = getSundaysRepository();
    return await repo.updatePaymentPolicy(actor.userId, parsed);
  } catch {
    return {
      success: false,
      error: "Could not save payment policy. Check your entries and try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Physical dining tables
// ---------------------------------------------------------------------------

const listDiningTablesFilterSchema = z.object({
  spaceId: z.string().uuid().optional(),
});

/**
 * List physical dining tables. Requires seating.read. An optional spaceId
 * filter is validated as a UUID before reaching the repository.
 *
 * Returns a discriminated union so authorization failure, invalid input, and
 * repository failure are never indistinguishable from a successful empty
 * inventory. Only a successful repository read may return { ok: true, tables: [] }.
 */
export async function serverListDiningTables(rawInput: unknown): Promise<DiningTableListResult> {
  try {
    await resolveSundaysActorWithPermission("seating.read");
  } catch {
    return { ok: false, error: "You are not authorized to view tables." };
  }
  try {
    const parsed = listDiningTablesFilterSchema.parse(rawInput ?? {});
    const repo = getSundaysRepository();
    const tables = await repo.listDiningTables(parsed.spaceId);
    return { ok: true, tables };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: "Invalid room filter." };
    }
    // Repository failure — never expose raw database errors.
    return { ok: false, error: "Could not load tables. Please try again." };
  }
}

/**
 * Create a physical dining table. Requires seating.manage. The verified
 * session user ID is passed as the audit actor; browser-supplied actor
 * identity is never accepted.
 */
export async function serverCreateDiningTable(
  rawInput: unknown,
): Promise<DiningTableOperationResult> {
  let actor;
  try {
    actor = await resolveSundaysActorWithPermission("seating.manage");
  } catch {
    return UNAUTHORIZED_TABLE;
  }
  try {
    const parsed = createDiningTableSchema.parse(rawInput);
    const repo = getSundaysRepository();
    return await repo.createDiningTable(actor.userId, parsed);
  } catch {
    return {
      success: false,
      error: "Could not create the table. Check your entries and try again.",
    };
  }
}

/**
 * Update or soft-disable a physical dining table. Requires seating.manage.
 * Uses expectedUpdatedAt for optimistic concurrency; a stale edit returns a
 * recognizable conflict result.
 */
export async function serverUpdateDiningTable(
  rawInput: unknown,
): Promise<DiningTableOperationResult> {
  let actor;
  try {
    actor = await resolveSundaysActorWithPermission("seating.manage");
  } catch {
    return UNAUTHORIZED_TABLE;
  }
  try {
    const parsed = updateDiningTableSchema.parse(rawInput);
    const repo = getSundaysRepository();
    return await repo.updateDiningTable(actor.userId, parsed);
  } catch {
    return {
      success: false,
      error: "Could not update the table. Check your entries and try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Room options for the Tables screen
// ---------------------------------------------------------------------------

/**
 * List room options for the Tables screen. Requires seating.read (NOT
 * availability.manage) so that users who can manage tables but not venue
 * configuration can still load room names for labeling and filtering.
 *
 * Returns a minimal projection — id, name, spaceType, isActive — with no
 * booking limits, audit actors, or other venue configuration. Inactive rooms
 * are included so existing tables can still display their room names.
 */
export async function serverListDiningTableRoomOptions(): Promise<DiningTableRoomOptionsResult> {
  try {
    await resolveSundaysActorWithPermission("seating.read");
  } catch {
    return { ok: false, error: "You are not authorized to view rooms." };
  }
  try {
    const repo = getSpaceRepository();
    const spaces = await repo.listAllSpaces();
    const rooms: DiningTableRoomOption[] = spaces.map((s) => ({
      id: s.id,
      name: s.name,
      spaceType: s.spaceType,
      isActive: s.isActive,
    }));
    return { ok: true, rooms };
  } catch {
    // Repository failure — never expose raw database errors, and never
    // treat a failure as a successful empty list.
    return { ok: false, error: "Could not load rooms. Please try again." };
  }
}
