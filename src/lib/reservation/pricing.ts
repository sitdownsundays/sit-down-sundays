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
import { calculateReservationCharges } from "./charges";
import type { ReservationGuestInput, ReservationPricingResult, ReviewedPrice } from "./types";

/** Default deposit percentage and balance deadline, mirrored from 0010 seed. */
const DEFAULT_DEPOSIT_PERCENT = 50;
const DEFAULT_BALANCE_DEADLINE_HOURS = 72;

export interface PaymentPolicyConfig {
  depositPercent: number;
  balanceDeadlineHours: number;
  restaurantTimezone: string | null;
  /**
   * Tax rate in basis points (1000 = 10%). null = not configured. Never zero
   * or false by default; those are valid explicit values.
   */
  taxRateBasisPoints: number | null;
  /**
   * Mandatory gratuity rate in basis points (1800 = 18%). null = not
   * configured.
   */
  gratuityRateBasisPoints: number | null;
  /**
   * Whether mandatory gratuity is included in the taxable amount. null = not
   * configured. An explicit boolean is required for charge calculation.
   */
  taxOnGratuity: boolean | null;
}

export function defaultPaymentPolicy(): PaymentPolicyConfig {
  return {
    depositPercent: DEFAULT_DEPOSIT_PERCENT,
    balanceDeadlineHours: DEFAULT_BALANCE_DEADLINE_HOURS,
    restaurantTimezone: null,
    taxRateBasisPoints: null,
    gratuityRateBasisPoints: null,
    taxOnGratuity: null,
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
  clientPreviewPrice?: import("./types").ReviewedPrice,
): ReservationPricingResult {
  // Map reservation guest inputs to the pricing engine's guest shape.
  // Omit the optional name when undefined (exactOptionalPropertyTypes);
  // preserve it when supplied.
  const orderGuests: OrderGuest[] = input.map((g) => {
    const guest: OrderGuest = {
      id: String(g.guestIndex),
      category: g.category,
      packageId: g.packageId,
      includedSelections: g.included.map((s) => ({
        menuItemId: s.menuItemId,
        selectionCategory: s.selectionCategory,
      })),
      addons: g.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
    };
    if (g.name !== undefined) guest.name = g.name;
    return guest;
  });

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

  // subtotalCents is the discounted FOOD subtotal from calculateOrder.
  // It is the base for gratuity, tax, and deposit — never re-charged.
  const subtotalCents = result.subtotalCents;

  // Convert the configured deposit percentage to basis points without changing
  // its meaning. The deposit applies to food only (excluding tax and gratuity).
  const depositBasisPoints = Math.round(policy.depositPercent * 100);

  // NULL means NOT CONFIGURED — never "zero charges." If ANY of the three
  // charge fields is null/undefined, the policy is incomplete and pricing
  // must fail safely. Only explicitly configured values (including an
  // explicit 0 rate and an explicit boolean) are valid. Do NOT use truthiness
  // checks: 0 and false are valid configured values that must be preserved.
  const CONFIG_ERROR =
    "Tax and gratuity are not fully configured. Please contact us to complete this reservation.";
  if (
    policy.taxRateBasisPoints === null ||
    policy.taxRateBasisPoints === undefined ||
    policy.gratuityRateBasisPoints === null ||
    policy.gratuityRateBasisPoints === undefined ||
    policy.taxOnGratuity === null ||
    policy.taxOnGratuity === undefined
  ) {
    return {
      success: false,
      error: CONFIG_ERROR,
      lines: [],
      subtotalCents: 0,
      depositRequiredCents: 0,
      grandTotalCents: 0,
      remainingBalanceCents: 0,
      balanceDeadline: null,
      hasUnresolvedRules: false,
      unresolvedNotes: [],
      pricingSnapshot: {},
      policySnapshot: {},
    };
  }

  // All three charge fields are explicitly configured — compute gratuity,
  // tax, and grand total via the charges helper. Any invalid rate or unsafe
  // arithmetic returns a safe failure; we never present a food-only subtotal
  // as a final total.
  const charges = calculateReservationCharges({
    foodSubtotalCents: subtotalCents,
    gratuityBasisPoints: policy.gratuityRateBasisPoints,
    taxBasisPoints: policy.taxRateBasisPoints,
    depositBasisPoints,
    taxOnGratuity: policy.taxOnGratuity,
  });

  if (!charges.ok) {
    return {
      success: false,
      error: charges.error,
      lines: [],
      subtotalCents: 0,
      depositRequiredCents: 0,
      grandTotalCents: 0,
      remainingBalanceCents: 0,
      balanceDeadline: null,
      hasUnresolvedRules: false,
      unresolvedNotes: [],
      pricingSnapshot: {},
      policySnapshot: {},
    };
  }

  // Use the charge breakdown — all three fields are configured and valid.
  const grandTotalCents = charges.grandTotalCents;
  const gratuityCents = charges.gratuityCents;
  const taxCents = charges.taxCents;
  const taxOnGratuityApplied = charges.taxOnGratuity;
  // Projected balance AFTER the required deposit is paid. This is a PROJECTION
  // (grandTotal − deposit), distinct from the actual outstanding balance
  // (the full grand total until payment is verified). Nothing is marked paid.
  const projectedBalanceAfterDepositCents = charges.projectedBalanceAfterDepositCents;

  // Deposit is the configured percentage of the FOOD subtotal, computed ONCE
  // in integer cents. Tax and gratuity are never in the deposit base.
  const depositRequiredCents = roundCents(
    Math.round((subtotalCents * policy.depositPercent) / 100),
  );

  // Outstanding balance for a newly submitted UNPAID request: nothing has been
  // paid, so the remaining balance equals the FULL grand total. The required
  // deposit is a separate field — it is money the customer must pay, NOT money
  // already received. A 100% required deposit does NOT mean the reservation
  // is paid.
  const remainingBalanceCents = grandTotalCents;

  // Balance deadline: policy hours before the seating start instant.
  const balanceDeadline = balanceDeadlineISO(seatingStartISO, policy.balanceDeadlineHours);

  // Detect config drift since the client preview. A NEW request MUST carry a
  // complete, valid ReviewedPrice — the subtotal-only legacy fallback applies
  // ONLY to replay of an already-saved request (handled by idempotency lookup
  // before this path is reached). For a NEW request, a missing ReviewedPrice is
  // itself a drift: the customer never saw the full authoritative breakdown.
  // When a full ReviewedPrice is supplied, compare EVERY financial term — not
  // just the subtotal. A change to gratuity, tax, grand total, deposit, or
  // applied rates/taxability/deposit% all require a fresh review.
  const isLegacyPreview =
    clientPreviewPrice === undefined && clientPreviewSubtotalCents !== undefined;
  let reviewRequired = false;
  if (clientPreviewPrice) {
    reviewRequired =
      clientPreviewPrice.subtotalCents !== subtotalCents ||
      clientPreviewPrice.gratuityCents !== gratuityCents ||
      clientPreviewPrice.taxCents !== taxCents ||
      clientPreviewPrice.grandTotalCents !== grandTotalCents ||
      clientPreviewPrice.depositRequiredCents !== depositRequiredCents ||
      clientPreviewPrice.appliedGratuityRateBasisPoints !== policy.gratuityRateBasisPoints ||
      clientPreviewPrice.appliedTaxRateBasisPoints !== policy.taxRateBasisPoints ||
      clientPreviewPrice.appliedTaxOnGratuity !== taxOnGratuityApplied ||
      clientPreviewPrice.appliedDepositPercent !== policy.depositPercent;
  } else if (isLegacyPreview) {
    reviewRequired = clientPreviewSubtotalCents !== subtotalCents;
  } else {
    // No ReviewedPrice and no legacy subtotal — a NEW request never reaches
    // persistence without a full reviewed breakdown. Flag as review-required.
    reviewRequired = true;
  }

  // Build the pricing lines: food lines from calculateOrder, then gratuity
  // and tax as separate labeled lines. All three charge fields are validated
  // non-null above, so no non-null assertions are needed.
  const lines = result.lines.map((l) => ({
    label: l.label,
    amountCents: l.amountCents,
    kind: l.kind,
  }));

  if (gratuityCents > 0) {
    lines.push({
      label: `Gratuity (${(policy.gratuityRateBasisPoints / 100).toFixed(2)}%)`,
      amountCents: gratuityCents,
      kind: "gratuity",
    });
  }
  if (taxCents > 0) {
    const taxLabel = taxOnGratuityApplied
      ? `Tax (${(policy.taxRateBasisPoints / 100).toFixed(2)}% incl. gratuity)`
      : `Tax (${(policy.taxRateBasisPoints / 100).toFixed(2)}%)`;
    lines.push({
      label: taxLabel,
      amountCents: taxCents,
      kind: "tax",
    });
  }

  const pricingSnapshot = {
    lines,
    subtotalCents,
    gratuityCents,
    taxCents,
    depositRequiredCents,
    grandTotalCents,
    remainingBalanceCents,
    hasUnresolvedRules: result.hasUnresolvedRules,
    unresolvedNotes: result.unresolvedNotes,
    appliedGratuityRateBasisPoints: policy.gratuityRateBasisPoints,
    appliedTaxRateBasisPoints: policy.taxRateBasisPoints,
    appliedTaxOnGratuity: policy.taxOnGratuity,
    appliedDepositPercent: policy.depositPercent,
  };
  const policySnapshot = {
    depositPercent: policy.depositPercent,
    balanceDeadlineHours: policy.balanceDeadlineHours,
    restaurantTimezone: policy.restaurantTimezone,
    taxRateBasisPoints: policy.taxRateBasisPoints,
    gratuityRateBasisPoints: policy.gratuityRateBasisPoints,
    taxOnGratuity: policy.taxOnGratuity,
    balanceDeadline,
  };

  // Build the authoritative reviewed-price snapshot for the client to carry
  // through to submission. The server compares this against a fresh
  // recalculation at submission time; a mismatch sets reviewRequired.
  const reviewedPrice: ReviewedPrice = {
    subtotalCents,
    gratuityCents,
    taxCents,
    grandTotalCents,
    depositRequiredCents,
    appliedGratuityRateBasisPoints: policy.gratuityRateBasisPoints,
    appliedTaxRateBasisPoints: policy.taxRateBasisPoints,
    appliedTaxOnGratuity: taxOnGratuityApplied,
    appliedDepositPercent: policy.depositPercent,
  };

  return {
    success: true,
    lines,
    subtotalCents,
    gratuityCents,
    taxCents,
    depositRequiredCents,
    grandTotalCents,
    remainingBalanceCents,
    // Projected balance AFTER applying the required deposit (grandTotal −
    // deposit). This is a PROJECTION of the balance that will remain after the
    // customer pays the deposit — NOT the actual outstanding balance before
    // any payment. remainingBalanceCents is the FULL unpaid balance for a new
    // request (equal to grandTotalCents). Do NOT repurpose either field.
    projectedBalanceAfterDepositCents: charges.projectedBalanceAfterDepositCents,
    balanceDeadline,
    hasUnresolvedRules: result.hasUnresolvedRules,
    unresolvedNotes: result.unresolvedNotes,
    reviewRequired,
    reviewedPrice,
    pricingSnapshot,
    policySnapshot,
  };
}
