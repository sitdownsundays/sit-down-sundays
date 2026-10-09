/**
 * Reservation pricing — adapts the existing calculateOrder engine for
 * reservation submission. ONE authoritative pricing path: the server refetches
 * live config, validates eligibility/counts/quantities, recalculates, and
 * rejects tampered client prices.
 *
 * Client-supplied prices/totals/actors are NEVER trusted. If config changed
 * since the client preview, the result flags reviewRequired so the customer
 * can re-review instead of silently accepting different terms.
 */
import type { OrderingConfigDTO } from "@/lib/ordering/types";
import { calculateOrder, roundCents } from "@/lib/ordering/pricing";
import type { OrderGuest, OrderPlatterLine } from "@/lib/ordering/pricing";
import { balanceDeadlineISO } from "./timezone";
import type { ReservationGuestInput, ReservationPricingResult } from "./types";

/** Default deposit percentage and balance deadline, mirrored from 0010 seed. */
const DEFAULT_DEPOSIT_PERCENT = 50;
const DEFAULT_BALANCE_DEADLINE_HOURS = 72;

export interface PaymentPolicyConfig {
  depositPercent: number;
  balanceDeadlineHours: number;
  restaurantTimezone: string | null;
}

export function defaultPaymentPolicy(): PaymentPolicyConfig {
  return {
    depositPercent: DEFAULT_DEPOSIT_PERCENT,
    balanceDeadlineHours: DEFAULT_BALANCE_DEADLINE_HOURS,
    restaurantTimezone: null,
  };
}

/**
 * Recalculate the authoritative price for a reservation request.
 * Returns immutable snapshots (pricing + policy) for persistence.
 */
export function calculateReservationPricing(
  input: ReservationGuestInput[],
  platters: Array<{ platterId: string; quantity: number }>,
  config: OrderingConfigDTO,
  policy: PaymentPolicyConfig,
  seatingStartISO: string | null,
  clientPreviewSubtotalCents?: number,
): ReservationPricingResult {
  // Map reservation guest inputs to the pricing engine's guest shape.
  const orderGuests: OrderGuest[] = input.map((g) => ({
    id: String(g.guestIndex),
    category: g.category,
    name: g.name,
    packageId: g.packageId,
    includedSelections: g.included.map((s) => ({
      menuItemId: s.menuItemId,
      selectionCategory: s.selectionCategory,
    })),
    addons: g.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
  }));

  const orderPlatters: OrderPlatterLine[] = platters.map((p) => ({
    platterId: p.platterId,
    quantity: p.quantity,
  }));

  const rules = config.guestPricingRules ?? {
    seniorDiscountPercent: null,
    seniorMinAge: null,
    seniorAppliesToPackages: false,
    seniorAppliesToAddons: false,
    seniorAppliesToPlatters: false,
    childRuleType: "none" as const,
    childDiscountPercent: null,
    childFixedPackagePriceCents: null,
    childMaxAge: null,
    childAppliesToPackages: false,
    childAppliesToAddons: false,
    childAppliesToPlatters: false,
    updatedAt: new Date(0).toISOString(),
  };

  const result = calculateOrder(orderGuests, orderPlatters, {
    packages: config.packages,
    addons: config.addons,
    platters: config.platters,
    rules,
  });

  const subtotalCents = result.subtotalCents;
  // Deposit is the configured percentage of the subtotal, computed ONCE in
  // integer cents. Do NOT also run it through depositForSubtotal(), which
  // applies a fixed 50% — that double-applies the deposit.
  const depositRequiredCents = roundCents(
    Math.round((subtotalCents * policy.depositPercent) / 100),
  );
  const grandTotalCents = subtotalCents;
  // Outstanding balance for a newly submitted UNPAID request: nothing has been
  // paid, so the remaining balance equals the FULL grand total. The required
  // deposit is a separate field — it is money the customer must pay, NOT money
  // already received. Do not subtract depositRequiredCents here; that would
  // confuse the outstanding balance with the anticipated balance after a
  // future deposit payment. A 100% required deposit does NOT mean the
  // reservation is paid.
  const remainingBalanceCents = grandTotalCents;

  // Balance deadline: policy hours before the seating start instant. The
  // seating instant must already be computed in the restaurant timezone via
  // seatingStartISO; this shared helper subtracts the configured hours.
  const balanceDeadline = balanceDeadlineISO(seatingStartISO, policy.balanceDeadlineHours);

  // Detect config drift since the client preview.
  const reviewRequired =
    clientPreviewSubtotalCents !== undefined && clientPreviewSubtotalCents !== subtotalCents;

  const pricingSnapshot = {
    lines: result.lines,
    subtotalCents,
    depositRequiredCents,
    grandTotalCents,
    remainingBalanceCents,
    hasUnresolvedRules: result.hasUnresolvedRules,
    unresolvedNotes: result.unresolvedNotes,
  };
  const policySnapshot = {
    depositPercent: policy.depositPercent,
    balanceDeadlineHours: policy.balanceDeadlineHours,
    restaurantTimezone: policy.restaurantTimezone,
    balanceDeadline,
  };

  return {
    success: true,
    lines: result.lines.map((l) => ({
      label: l.label,
      amountCents: l.amountCents,
      kind: l.kind,
    })),
    subtotalCents,
    depositRequiredCents,
    grandTotalCents,
    remainingBalanceCents,
    balanceDeadline,
    hasUnresolvedRules: result.hasUnresolvedRules,
    unresolvedNotes: result.unresolvedNotes,
    reviewRequired,
    pricingSnapshot,
    policySnapshot,
  };
}
