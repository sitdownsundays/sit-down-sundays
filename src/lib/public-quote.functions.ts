/**
 * Public order quote — server-authoritative pricing estimate for the booking
 * wizard.
 *
 * Reuses the EXISTING calculateOrder pricing engine (via
 * calculateReservationPricing) — there is ONE calculation path. The client
 * never computes totals; this returns the authoritative estimate. The final
 * submission revalidates again, so this is labeled an ESTIMATE.
 *
 * No payment is collected, no reservation is persisted. Client prices/totals
 * are never trusted; the server refetches live config and recalculates.
 *
 * No session required (public). No direct browser Supabase access.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GUEST_CATEGORIES, SELECTION_CATEGORIES } from "@/lib/ordering/constants";
import { getOrderingRepository } from "@/lib/server/ordering-repository.server";
import { getSundaysRepository } from "@/lib/server/sundays-repository.server";
import { validatePartyWideMeal } from "@/lib/server/party-meal-validation.server";
import { normalizeQuoteGuests } from "@/lib/server/public-quote-normalize.server";
import { calculateReservationPricing, defaultPaymentPolicy } from "@/lib/reservation/pricing";
import { seatingStartISO } from "@/lib/reservation/timezone";
import type { ReviewedPrice } from "@/lib/reservation/types";

const quoteGuestSchema = z.object({
  guestIndex: z.number().int().min(0),
  // Pass the readonly literal tuple directly so z.enum infers the exact
  // GuestCategory union ("adult" | "senior" | "child") rather than widening
  // to string through an `as unknown as [string, ...string[]]` cast.
  category: z.enum(GUEST_CATEGORIES),
  name: z.string().max(160).optional(),
  packageId: z.string().min(1),
  included: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        selectionCategory: z.enum(SELECTION_CATEGORIES),
      }),
    )
    .default([]),
  addons: z
    .array(z.object({ addonId: z.string().min(1), quantity: z.number().int().min(0) }))
    .default([]),
});

const quotePlatterSchema = z.object({
  platterId: z.string().min(1),
  quantity: z.number().int().min(0),
});

export const quoteOrderSchema = z.object({
  sundayServiceId: z.string().min(1),
  seatingTimeId: z.string().min(1),
  guests: z.array(quoteGuestSchema).min(1),
  platters: z.array(quotePlatterSchema).default([]),
});

export type QuoteOrderInput = z.infer<typeof quoteOrderSchema>;

export interface QuoteResult {
  ok: boolean;
  lines?: Array<{ label: string; amountCents: number; kind: string }>;
  subtotalCents?: number;
  depositRequiredCents?: number;
  grandTotalCents?: number;
  /**
   * The FULL actual unpaid balance for a new request (equals grandTotalCents
   * before any payment). Do NOT repurpose this as the projected balance after
   * deposit.
   */
  remainingBalanceCents?: number;
  /**
   * Projected balance AFTER the required deposit is paid (grandTotal −
   * deposit). This is a PROJECTION of what will remain after the deposit is
   * collected — NOT the actual outstanding balance before any payment.
   */
  projectedBalanceAfterDepositCents?: number;
  hasUnresolvedRules?: boolean;
  unresolvedNotes?: string[];
  /** Full reviewed-price snapshot for the submission drift check. */
  reviewedPrice?: ReviewedPrice;
  error?: string;
}

export const quoteOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => quoteOrderSchema.parse(d))
  .handler(async ({ data }): Promise<QuoteResult> => {
    try {
      const orderingRepo = getOrderingRepository();
      const sundaysRepo = getSundaysRepository();
      const config = await orderingRepo.getOrderingConfig();
      const policy = await sundaysRepo.getPaymentPolicy();

      // Party-wide meal validation: ONE package for the entire party with
      // SHARED included selections. Rejects mixed packages, mismatched or
      // duplicate selections, wrong counts, ineligible items, and
      // individual add-ons in public ordering. Returns a safe error without
      // calculating pricing.
      // Normalize the parsed guests (exact GuestCategory/SelectionCategory
      // unions) into authoritative ReservationGuestInput[] without an
      // unchecked cast. The same normalized guests are passed to both the
      // party-wide validation and the pricing engine.
      const guests = normalizeQuoteGuests(data.guests);

      const mealValidation = validatePartyWideMeal(guests, config);
      if (!mealValidation.ok) {
        return { ok: false, error: mealValidation.error.message };
      }

      // Resolve the seating start instant in the restaurant timezone for the
      // balance deadline. If the policy/timezone is unavailable, fall back to
      // defaults with a null seating instant (deadline will be null).
      // Populate the three nullable tax/gratuity settings from the server-
      // fetched payment policy. Never accept rates or taxability from the
      // browser.
      const policyConfig =
        policy !== null
          ? {
              depositPercent: policy.depositPercent,
              balanceDeadlineHours: policy.defaultBalanceDeadlineHours,
              restaurantTimezone: policy.restaurantTimezone,
              taxRateBasisPoints: policy.taxRateBasisPoints,
              gratuityRateBasisPoints: policy.gratuityRateBasisPoints,
              taxOnGratuity: policy.taxOnGratuity,
            }
          : defaultPaymentPolicy();

      let seatingStart: string | null = null;
      if (policyConfig.restaurantTimezone) {
        const service = await sundaysRepo.getSundayService(data.sundayServiceId);
        const seatings = await sundaysRepo.listSeatingTimesForService(data.sundayServiceId);
        const seating = seatings.find((s) => s.id === data.seatingTimeId);
        if (service && seating) {
          seatingStart = seatingStartISO(
            service.date,
            seating.startTime,
            policyConfig.restaurantTimezone,
          );
        }
      }

      const result = calculateReservationPricing(
        guests,
        data.platters,
        config,
        policyConfig,
        seatingStart,
        undefined,
        undefined,
      );

      // The public quote handler must check pricing.success and return
      // ok:false on failure. Do not wrap a failed pricing calculation in
      // ok:true — a food-only subtotal is not a valid estimate when charges
      // were expected.
      if (!result.success) {
        return { ok: false, error: result.error ?? "We couldn't calculate your estimate." };
      }

      // Unresolved pricing rules (e.g. a malformed per-package child/senior
      // override) must NOT produce a usable estimate beside a warning. The
      // incomplete total is not a valid estimate — fail closed.
      if (result.hasUnresolvedRules) {
        return {
          ok: false,
          error:
            "Some pricing rules are not configured. Please contact us to complete this reservation.",
        };
      }

      return {
        ok: true,
        lines: result.lines,
        subtotalCents: result.subtotalCents,
        depositRequiredCents: result.depositRequiredCents,
        grandTotalCents: result.grandTotalCents,
        remainingBalanceCents: result.remainingBalanceCents,
        projectedBalanceAfterDepositCents: result.projectedBalanceAfterDepositCents,
        hasUnresolvedRules: result.hasUnresolvedRules,
        unresolvedNotes: result.unresolvedNotes,
        reviewedPrice: result.reviewedPrice,
      };
    } catch {
      return {
        ok: false,
        error: "We couldn't calculate your estimate. Please try again.",
      };
    }
  });
