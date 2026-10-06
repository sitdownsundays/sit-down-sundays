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
} from "@/lib/sundays/schema";
import { getSundaysRepository } from "./sundays-repository.server";
import { resolveSundaysActor, SundaysAuthorizationError } from "./sundays-auth.server";
import type {
  SundayServiceDTO,
  SeatingTimeDTO,
  PaymentPolicyDTO,
  SundayServiceOperationResult,
  SeatingTimeOperationResult,
  PaymentPolicyOperationResult,
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
  return repo.listAllSundayServices();
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
    return repo.createSundayService(actor.userId, parsed);
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
    return repo.updateSundayService(actor.userId, parsed);
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
  return repo.listSeatingTimesForService(sundayServiceId);
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
    return repo.createSeatingTime(actor.userId, parsed);
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
    return repo.updateSeatingTime(actor.userId, parsed);
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
      updatedAt: "",
    };
  }
  const repo = getSundaysRepository();
  return repo.getPaymentPolicy();
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
    return repo.updatePaymentPolicy(actor.userId, parsed);
  } catch {
    return {
      success: false,
      error: "Could not save payment policy. Check your entries and try again.",
    };
  }
}
