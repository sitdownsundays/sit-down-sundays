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
import { calculateReservationPricing, defaultPaymentPolicy } from "@/lib/reservation/pricing";
import { seatingStartISO } from "@/lib/reservation/timezone";
import type { ReservationGuestInput } from "@/lib/reservation/types";

const quoteGuestSchema = z.object({
  guestIndex: z.number().int().min(0),
  category: z.enum(GUEST_CATEGORIES as unknown as [string, ...string[]]),
  name: z.string().max(160).optional(),
  packageId: z.string().min(1),
  included: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        selectionCategory: z.enum(SELECTION_CATEGORIES as unknown as [string, ...string[]]),
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
  remainingBalanceCents?: number;
  hasUnresolvedRules?: boolean;
  unresolvedNotes?: string[];
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
      const mealValidation = validatePartyWideMeal(data.guests as ReservationGuestInput[], config);
      if (!mealValidation.ok) {
        return { ok: false, error: mealValidation.error.message };
      }

      // Resolve the seating start instant in the restaurant timezone for the
      // balance deadline. If the policy/timezone is unavailable, fall back to
      // defaults with a null seating instant (deadline will be null).
      const policyConfig =
        policy !== null
          ? {
              depositPercent: policy.depositPercent,
              balanceDeadlineHours: policy.defaultBalanceDeadlineHours,
              restaurantTimezone: policy.restaurantTimezone,
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
        data.guests,
        data.platters,
        config,
        policyConfig,
        seatingStart,
      );

      return {
        ok: true,
        lines: result.lines,
        subtotalCents: result.subtotalCents,
        depositRequiredCents: result.depositRequiredCents,
        grandTotalCents: result.grandTotalCents,
        remainingBalanceCents: result.remainingBalanceCents,
        hasUnresolvedRules: result.hasUnresolvedRules,
        unresolvedNotes: result.unresolvedNotes,
      };
    } catch {
      return {
        ok: false,
        error: "We couldn't calculate your estimate. Please try again.",
      };
    }
  });
