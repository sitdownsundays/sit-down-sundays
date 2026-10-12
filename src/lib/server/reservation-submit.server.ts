/**
 * SERVER-ONLY — reservation submission core logic.
 *
 * Extracted from the submitReservationRequest server function so the full
 * validation → eligibility → pricing → snapshot → persistence path is testable
 * WITHOUT the TanStack Start runtime context (createServerFn requires an
 * AsyncLocalStorage context that does not exist in Vitest). The thin
 * createServerFn wrapper in reservation.functions.ts delegates here.
 *
 * AUTHORIZATION:
 *  - This is the PUBLIC submission path. It does NOT require a session.
 *  - It validates inputs, refetches authoritative config, recalculates prices,
 *    builds trusted snapshots, and persists through the atomic repository
 *    method. Client prices/totals/actors are NEVER trusted.
 *  - Raw Supabase errors, credentials, and stack traces are never exposed.
 *
 * Requests remain pending_review / unpaid. No confirmed inventory, no payment
 * collection, no Stripe in this phase.
 *
 * IDEMPOTENCY:
 *  - Before any re-validation or re-pricing, the handler looks up the
 *    idempotency key + canonical payload hash. A matching already-saved
 *    request is replayed as-is WITHOUT re-pricing or re-validating eligibility,
 *    so a saved reservation stays safely replayable even if pricing
 *    configuration has since changed. A key reused with a different payload
 *    returns idempotency_key_mismatch.
 */
import { createHash } from "node:crypto";
import { getReservationRepository } from "./reservation-repository.server";
import { buildReservationSnapshots } from "./reservation-snapshot.server";
import { getOrderingRepository } from "./ordering-repository.server";
import { getSundaysRepository } from "./sundays-repository.server";
import { getSpaceRepository } from "./space-repository.server";
import {
  validateNewRequestEligibility,
  validatePartyComposition,
} from "./reservation-eligibility.server";
import { validatePartyWideMeal } from "./party-meal-validation.server";
import { calculateReservationPricing } from "@/lib/reservation/pricing";
import { generateReservationNumber } from "@/lib/reservation/schema";
import type { SubmitReservationRequestInput } from "@/lib/reservation/types";
import type { SubmitReservationResult } from "@/lib/reservation/types";

const SAFE_ERROR = "We couldn't complete this reservation request. Please try again.";

/**
 * Build a canonical payload hash for idempotency (excludes reservation number).
 *
 * Guest notes are normalized so that:
 *  - missing and explicit-empty-string notes are equivalent (both → "");
 *  - different non-empty notes produce different hashes;
 *  - a legacy payload with no note fields hashes the same as one with empty
 *    strings, preserving replayability of existing no-note requests.
 *
 * Only the three per-guest note fields (foodAllergies, dietaryPreferences,
 * mealRequests) are normalized — other fields are stringified as-is.
 */
export function buildPayloadHash(input: Record<string, unknown>): string {
  const normalized = {
    ...input,
    guests: Array.isArray(input["guests"])
      ? (input["guests"] as Array<Record<string, unknown>>).map((g) => ({
          ...g,
          foodAllergies: typeof g["foodAllergies"] === "string" ? g["foodAllergies"] : "",
          dietaryPreferences:
            typeof g["dietaryPreferences"] === "string" ? g["dietaryPreferences"] : "",
          mealRequests: typeof g["mealRequests"] === "string" ? g["mealRequests"] : "",
        }))
      : input["guests"],
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Core submission handler. Performs the full server-authoritative path:
 *  1. Reject private-room requests (standard public flow only).
 *  2. Validate party composition (counts, indices, category match).
 *  3. Compute the canonical payload hash for idempotency.
 *  4. Short-circuit on an already-saved matching request (safe replay) BEFORE
 *     re-validation/re-pricing — a saved reservation is never repriced on retry.
 *  5. Refetch authoritative ordering config + payment policy + service/seating/space.
 *  6. Shared eligibility validation (identical rules to public availability).
 *  7. Authoritative pricing recalculation (never trust client prices).
 *  8. Reject unresolved pricing or review-required drift.
 *  9. Build trusted snapshots from authoritative config.
 * 10. Persist through the repository (atomic in Supabase mode).
 *
 * Returns a safe SubmitReservationResult. Never throws raw errors to callers.
 */
export async function handleSubmitReservationRequest(
  data: SubmitReservationRequestInput,
): Promise<SubmitReservationResult> {
  try {
    // Reject private-room requests in this standard public flow. Do not
    // invent private-room booking behavior.
    if (data.experienceType === "private_room") {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "invalid_data",
        error: "Private room requests are not available through this form. Please contact us.",
      };
    }

    // Verify party composition: counts sum to party size, one allocation per
    // guest, unique indices, and actual guest categories match the declared
    // adults/seniors/children. A request declaring two adults but supplying
    // two child allocations fails.
    const compositionError = validatePartyComposition({
      partySize: data.partySize,
      adults: data.adults,
      seniors: data.seniors,
      children: data.children,
      guests: data.guests,
    });
    if (compositionError) {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "validation_failed",
        error: compositionError,
      };
    }

    // Canonical payload hash for idempotency (excludes reservation number).
    // Guest notes are normalized: missing and empty-string notes are equivalent
    // (both canonicalize to ""), so a no-note request hashes the same whether
    // the client omitted the fields or sent empty strings. Different non-empty
    // notes produce different hashes. This preserves replayability of
    // existing no-note requests while making note changes detectable.
    // Include the reviewed-price terms in the canonical request identity so a
    // change to ANY reviewed financial term (subtotal, gratuity, tax, grand
    // total, deposit, or applied rates/taxability/deposit%) changes the hash.
    // This means a retry with changed terms is treated as a NEW request (not a
    // replay of the old one). Legacy payloads that omit clientPreviewPrice are
    // preserved: the field is only included when supplied, so an absent
    // clientPreviewPrice hashes identically to the pre-change implementation.
    const payloadHash = buildPayloadHash({
      sundayServiceId: data.sundayServiceId,
      seatingTimeId: data.seatingTimeId,
      experienceType: data.experienceType,
      partySize: data.partySize,
      adults: data.adults,
      seniors: data.seniors,
      children: data.children,
      contactFirstName: data.contactFirstName,
      contactLastName: data.contactLastName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      guestNotes: data.guestNotes ?? "",
      dietaryNotes: data.dietaryNotes ?? "",
      accessibilityRequests: data.accessibilityRequests ?? "",
      occasion: data.occasion ?? "",
      guests: data.guests.map((g) => ({
        guestIndex: g.guestIndex,
        category: g.category,
        name: g.name ?? "",
        packageId: g.packageId,
        included: g.included,
        addons: g.addons,
        foodAllergies: g.foodAllergies ?? "",
        dietaryPreferences: g.dietaryPreferences ?? "",
        mealRequests: g.mealRequests ?? "",
      })),
      platters: data.platters,
      ...(data.clientPreviewPrice ? { clientPreviewPrice: data.clientPreviewPrice } : {}),
    });

    // Idempotency: short-circuit an already-saved matching request BEFORE any
    // re-validation or re-pricing. A saved reservation stays safely replayable
    // even if pricing configuration has since changed — it is never repriced
    // on retry. A key reused with a different payload returns a mismatch.
    const repo = getReservationRepository();
    const existing = await repo.findByIdempotencyKey(data.idempotencyKey, payloadHash);
    if (existing) {
      return existing;
    }

    // Refetch authoritative configuration (packages, addons, platters, rules).
    const orderingRepo = getOrderingRepository();
    const sundaysRepo = getSundaysRepository();
    const spacesRepo = getSpaceRepository();
    const config = await orderingRepo.getOrderingConfig();

    // Resolve payment policy + selected service/seating/space for eligibility
    // and pricing context. All refetched server-side — never trusted from
    // the browser. The three nullable tax/gratuity settings are populated
    // from the server-fetched payment policy — never accepted from the
    // browser. NULL means NOT CONFIGURED (never "zero charges"): if ANY of
    // the three is null/undefined, calculateReservationPricing fails safely
    // and this returns proven_rejection / pricing_failed before persistence.
    // Only explicitly configured values (including explicit 0 rates and an
    // explicit boolean) produce a valid charge calculation.
    const policyDTO = await sundaysRepo.getPaymentPolicy();
    const policy = {
      depositPercent: policyDTO.depositPercent,
      balanceDeadlineHours: policyDTO.defaultBalanceDeadlineHours,
      restaurantTimezone: policyDTO.restaurantTimezone,
      taxRateBasisPoints: policyDTO.taxRateBasisPoints,
      gratuityRateBasisPoints: policyDTO.gratuityRateBasisPoints,
      taxOnGratuity: policyDTO.taxOnGratuity,
    };
    const service = await sundaysRepo.getSundayService(data.sundayServiceId);
    const seatings = await sundaysRepo.listSeatingTimesForService(data.sundayServiceId);
    const seating = seatings.find((s) => s.id === data.seatingTimeId) ?? null;
    const allSpaces = await spacesRepo.listAllSpaces();
    const space = allSpaces.find((s) => s.id === service?.spaceId) ?? null;

    // Shared eligibility validation — identical rules to public availability.
    // Rejects inactive/request-only/missing space, closed/inactive/missing
    // service, missing/inactive/mismatched seating, null/zero limits, past
    // seating, invalid/missing timezone, and oversized parties. Zero writes.
    const eligibility = validateNewRequestEligibility(
      { service, seating, space, policy: policyDTO },
      data.partySize,
    );
    if (!eligibility.ok) {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "eligibility_failed",
        error: eligibility.error ?? SAFE_ERROR,
      };
    }
    const seatingInstant = eligibility.seatingInstant ?? null;

    // Party-wide meal validation (public flow only) — ONE package for the
    // entire party with SHARED included selections (meats, sides, and one
    // bread). Rejects mixed packages, mismatched or duplicate selections,
    // wrong meat/side counts, ineligible items, and individual add-ons in
    // public ordering. Returns proven_rejection with a safe code/message —
    // zero writes. Runs AFTER the idempotency replay check above so
    // historical reservations with per-guest meals remain safely replayable.
    const mealValidation = validatePartyWideMeal(data.guests, config);
    if (!mealValidation.ok) {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "validation_failed",
        error: mealValidation.error.message,
      };
    }

    // Authoritative pricing recalculation — never trust client prices.
    const pricing = calculateReservationPricing(
      data.guests,
      data.platters,
      config,
      policy,
      seatingInstant,
      data.clientPreviewSubtotalCents,
      data.clientPreviewPrice,
    );

    if (!pricing.success) {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "pricing_failed",
        error: pricing.error ?? "Pricing could not be calculated.",
      };
    }

    // Reject unresolved pricing — never present an incomplete total as final.
    if (pricing.hasUnresolvedRules) {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "unresolved_pricing",
        error:
          "Some pricing rules are not configured. Please contact us to complete this reservation.",
      };
    }

    // NEW-REQUEST GUARD: after the idempotency replay check above confirmed
    // there is NO saved matching request, a NEW request MUST carry a complete
    // reviewed-price snapshot (clientPreviewPrice). Historical compatibility
    // applies ONLY to matching already-saved requests (returned above before
    // this point). A new request that omits clientPreviewPrice must NOT slip
    // through the subtotal-only fallback in calculateReservationPricing — the
    // customer must review the authoritative estimate before persistence.
    // Zero writes: this returns before the snapshot/persistence path below.
    if (!data.clientPreviewPrice) {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "review_required",
        error:
          "Our menu or pricing has changed since you started. Please review your selections and try again.",
      };
    }

    // Detect meaningful config drift since the client preview (not just subtotal).
    if (pricing.reviewRequired) {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "review_required",
        error:
          "Our menu or pricing has changed since you started. Please review your selections and try again.",
      };
    }

    // Build trusted snapshots from authoritative config — never client names/prices.
    let snapshots;
    try {
      snapshots = buildReservationSnapshots(data.guests, data.platters, config);
    } catch {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "invalid_reference",
        error: "A selected item is no longer available. Please review your choices.",
      };
    }

    const reservationNumber = generateReservationNumber();

    const result = await repo.submitRequest({
      reservationNumber,
      contactFirstName: data.contactFirstName,
      contactLastName: data.contactLastName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      sundayServiceId: data.sundayServiceId,
      seatingTimeId: data.seatingTimeId,
      experienceType: data.experienceType,
      privateRoomId: null,
      partySize: data.partySize,
      adults: data.adults,
      seniors: data.seniors,
      children: data.children,
      guestNotes: data.guestNotes ?? "",
      dietaryNotes: data.dietaryNotes ?? "",
      accessibilityRequests: data.accessibilityRequests ?? "",
      occasion: data.occasion ?? "",
      pricing,
      guests: data.guests,
      platters: data.platters,
      idempotencyKey: data.idempotencyKey,
      payloadHash,
      actorUserId: null,
      snapshots,
    });

    return result;
  } catch {
    return { success: false, error: SAFE_ERROR };
  }
}
