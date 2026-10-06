/**
 * Ordering — server-authoritative pricing calculation engine.
 *
 * ONE calculation path used by both the admin "Preview an order" tool and the
 * future public checkout. Pure functions over config snapshots + an order
 * draft. No I/O, no server imports, no secrets. Safe to unit-test directly.
 *
 * Core rules (per owner direction):
 *  - Package price is PER PERSON and covers its included selection counts.
 *    Included dishes are NEVER charged again.
 *  - Individual add-ons are priced per unit, attached to one guest.
 *  - Shared platters are priced PER PLATTER × quantity; they never multiply
 *    by guest count and never receive senior/child discounts automatically.
 *  - Senior discount is a confirmed 5% (staff-configurable age + scope).
 *  - Child pricing uses an explicitly selected rule: fixed package price OR
 *    percentage discount. Missing rules stay visibly unconfigured — never
 *    silently free or full-price.
 *  - Tax/fee rules are out of scope here; the caller surfaces unresolved
 *    tax/fee config as "Not configured" rather than presenting an incomplete
 *    subtotal as a final payable total.
 *
 * INCLUDED SELECTION VALIDATION:
 *  - Each guest's included selections are validated against the package's
 *    eligible items (same menu_item + matching selection_category) and the
 *    package's included counts. Ineligible or over-count selections are
 *    reported as unresolved notes and DO NOT add catalog prices.
 *  - Whether duplicate meat/side selections are allowed is intentionally left
 *    UNCONFIGURED until the owner confirms. The engine does not enforce
 *    uniqueness; it only enforces the count and eligibility.
 */
import type { GuestCategory } from "./constants";
import type {
  GuestPricingRulesDTO,
  MealPackageDTO,
  IndividualAddonDTO,
  SharedPlatterDTO,
  EligibleItemDTO,
} from "./types";

export interface OrderGuest {
  id: string;
  category: GuestCategory;
  /** Optional friendly name ("Guest 1" is fine when omitted). */
  name?: string;
  packageId: string;
  /** Included dish selections covered by the package price (not re-charged). */
  includedSelections: Array<{ menuItemId: string; selectionCategory: string }>;
  /** Individual add-ons attached to this guest, each { addonId, quantity }. */
  addons: Array<{ addonId: string; quantity: number }>;
}

export interface OrderPlatterLine {
  platterId: string;
  quantity: number;
}

export interface PriceLine {
  label: string;
  /** Negative for discounts, positive for charges. */
  amountCents: number;
  kind: "package" | "addon" | "platter" | "senior_discount" | "child_rule";
  guestLabel?: string;
}

export interface PricingResult {
  lines: PriceLine[];
  subtotalCents: number;
  /** True when a guest category lacks a configured rule, so the subtotal is
   *  NOT a final payable total. The UI must show "Not configured". */
  hasUnresolvedRules: boolean;
  unresolvedNotes: string[];
}

export interface PricingConfigSnapshot {
  packages: MealPackageDTO[];
  addons: IndividualAddonDTO[];
  platters: SharedPlatterDTO[];
  rules: GuestPricingRulesDTO;
}

/** Integer cents math: round half-up to avoid floating drift. */
function roundCents(value: number): number {
  return Math.round(value);
}

function activeById<T extends { id: string; isActive: boolean }>(
  list: T[],
  id: string,
): T | undefined {
  return list.find((x) => x.id === id && x.isActive);
}

/** Apply a percentage discount to a charge amount, returning the discount value (>=0). */
function discountAmount(chargeCents: number, percent: number): number {
  if (chargeCents <= 0 || percent <= 0) return 0;
  return roundCents((chargeCents * percent) / 100);
}

/**
 * Validate a guest's included selections against the package's eligible items
 * and included counts. Returns notes for ineligible or over-count selections.
 * Included selections are NEVER charged again — this only produces validation
 * notes, never price lines.
 *
 * Duplicate-selection uniqueness is intentionally NOT enforced here; the owner
 * has not confirmed whether a guest may pick the same meat/side twice.
 */
export function validateIncludedSelections(guest: OrderGuest, pkg: MealPackageDTO): string[] {
  const notes: string[] = [];
  const guestLabel = guest.name?.trim() || "Guest";

  const eligibleByCategory = new Map<string, Set<string>>();
  for (const e of pkg.eligibleItems) {
    let set = eligibleByCategory.get(e.selectionCategory);
    if (!set) {
      set = new Set();
      eligibleByCategory.set(e.selectionCategory, set);
    }
    set.add(e.menuItemId);
  }

  const countsByCategory = new Map<string, number>();
  for (const sel of guest.includedSelections) {
    const eligible = eligibleByCategory.get(sel.selectionCategory);
    if (!eligible || !eligible.has(sel.menuItemId)) {
      notes.push(
        `${guestLabel}: an included ${sel.selectionCategory} selection is not eligible for ${pkg.name}.`,
      );
      continue;
    }
    countsByCategory.set(
      sel.selectionCategory,
      (countsByCategory.get(sel.selectionCategory) ?? 0) + 1,
    );
  }

  const expected: Record<string, number> = {
    meat: pkg.includedMeatsCount,
    side: pkg.includedSidesCount,
  };
  for (const cat of Object.keys(expected)) {
    const have = countsByCategory.get(cat) ?? 0;
    const want = expected[cat];
    if (have !== want) {
      notes.push(
        `${guestLabel}: ${pkg.name} requires ${want} ${cat}${want === 1 ? "" : "s"}; ${have} selected.`,
      );
    }
  }

  // Bread/drink are single optional inclusions, not count-based. If the
  // package includes them, a guest may select one eligible item of that
  // category; we do not require it (the inclusion is covered regardless).
  return notes;
}

/**
 * Compute the per-person package charge for a guest, applying any configured
 * senior/child rule. Returns the charge and the discount applied (0 if none).
 */
function guestPackageCharge(
  guest: OrderGuest,
  pkg: MealPackageDTO,
  rules: GuestPricingRulesDTO,
): { chargeCents: number; discountCents: number; note?: string } {
  const base = pkg.pricePerPersonCents;

  if (guest.category === "senior") {
    if (rules.seniorDiscountPercent === null || rules.seniorMinAge === null) {
      // Senior rule not fully configured — flag as unresolved, charge full price.
      return {
        chargeCents: base,
        discountCents: 0,
        note: "Senior discount age is not configured; full package price applied.",
      };
    }
    if (!rules.seniorAppliesToPackages) {
      return { chargeCents: base, discountCents: 0 };
    }
    const disc = discountAmount(base, rules.seniorDiscountPercent);
    // chargeCents is the GROSS package price; discountCents is the single
    // discount applied as a separate line. Returning the net here would
    // double-discount because calculateOrder also subtracts discountCents.
    return { chargeCents: base, discountCents: disc };
  }

  if (guest.category === "child") {
    if (rules.childRuleType === "none" || rules.childMaxAge === null) {
      return {
        chargeCents: base,
        discountCents: 0,
        note: "Child pricing is not configured; full package price applied.",
      };
    }
    if (rules.childRuleType === "fixed_package_price") {
      if (rules.childFixedPackagePriceCents === null) {
        return {
          chargeCents: base,
          discountCents: 0,
          note: "Child fixed price is not configured; full package price applied.",
        };
      }
      const childPrice = rules.childFixedPackagePriceCents;
      // Gross base charged; the discount line carries (base - childPrice).
      return { chargeCents: base, discountCents: base - childPrice };
    }
    if (rules.childRuleType === "percentage_discount") {
      if (rules.childDiscountPercent === null || !rules.childAppliesToPackages) {
        return { chargeCents: base, discountCents: 0 };
      }
      const disc = discountAmount(base, rules.childDiscountPercent);
      return { chargeCents: base, discountCents: disc };
    }
  }

  return { chargeCents: base, discountCents: 0 };
}

/**
 * Calculate a full itemized order preview.
 *
 * Included dish selections are validated against the package's eligible items
 * but are NEVER charged again. Individual add-ons are charged per unit.
 * Shared platters are charged per platter × quantity. Senior/child discounts
 * apply only to the configured charge scopes, never to platters automatically.
 */
export function calculateOrder(
  guests: OrderGuest[],
  platters: OrderPlatterLine[],
  config: PricingConfigSnapshot,
): PricingResult {
  const lines: PriceLine[] = [];
  const unresolvedNotes: string[] = [];
  let subtotalCents = 0;

  for (const guest of guests) {
    const pkg = activeById(config.packages, guest.packageId);
    const guestLabel = guest.name?.trim() || `Guest`;
    if (!pkg) {
      unresolvedNotes.push(`${guestLabel}: selected package is unavailable.`);
      continue;
    }

    // Validate included selections (counts + eligibility). These never add
    // catalog prices — they only produce unresolved notes.
    const selectionNotes = validateIncludedSelections(guest, pkg);
    unresolvedNotes.push(...selectionNotes);

    const { chargeCents, discountCents, note } = guestPackageCharge(guest, pkg, config.rules);
    if (note) unresolvedNotes.push(`${guestLabel}: ${note}`);

    lines.push({
      label: `${pkg.name} (${guestLabel})`,
      amountCents: chargeCents,
      kind: "package",
      guestLabel,
    });
    subtotalCents += chargeCents;

    if (discountCents > 0) {
      const ruleKind = guest.category === "senior" ? "senior_discount" : "child_rule";
      lines.push({
        label: `${guest.category === "senior" ? "Senior" : "Child"} discount (${guestLabel})`,
        amountCents: -discountCents,
        kind: ruleKind,
        guestLabel,
      });
      subtotalCents -= discountCents;
    }

    // Individual add-ons — charged per unit. Senior/child discount may apply
    // to add-ons per the configured scope.
    for (const line of guest.addons) {
      const addon = activeById(config.addons, line.addonId);
      if (!addon) {
        unresolvedNotes.push(`${guestLabel}: an add-on is unavailable.`);
        continue;
      }
      // Eligibility: empty eligiblePackageIds means eligible for all packages.
      if (addon.eligiblePackageIds.length > 0 && !addon.eligiblePackageIds.includes(pkg.id)) {
        unresolvedNotes.push(
          `${guestLabel}: add-on "${addon.name}" is not eligible for ${pkg.name}.`,
        );
        continue;
      }
      const qty = Math.max(1, Math.trunc(line.quantity));
      const addonCharge = addon.priceCents * qty;
      let addonNet = addonCharge;
      if (
        guest.category === "senior" &&
        config.rules.seniorAppliesToAddons &&
        config.rules.seniorDiscountPercent !== null
      ) {
        const d = discountAmount(addonCharge, config.rules.seniorDiscountPercent);
        addonNet = addonCharge - d;
        lines.push({
          label: `${addon.name} ×${qty} (${guestLabel})`,
          amountCents: addonCharge,
          kind: "addon",
          guestLabel,
        });
        lines.push({
          label: `Senior discount (${guestLabel}, ${addon.name})`,
          amountCents: -d,
          kind: "senior_discount",
          guestLabel,
        });
      } else if (
        guest.category === "child" &&
        config.rules.childRuleType === "percentage_discount" &&
        config.rules.childAppliesToAddons &&
        config.rules.childDiscountPercent !== null
      ) {
        const d = discountAmount(addonCharge, config.rules.childDiscountPercent);
        addonNet = addonCharge - d;
        lines.push({
          label: `${addon.name} ×${qty} (${guestLabel})`,
          amountCents: addonCharge,
          kind: "addon",
          guestLabel,
        });
        lines.push({
          label: `Child discount (${guestLabel}, ${addon.name})`,
          amountCents: -d,
          kind: "child_rule",
          guestLabel,
        });
      } else {
        lines.push({
          label: `${addon.name} ×${qty} (${guestLabel})`,
          amountCents: addonCharge,
          kind: "addon",
          guestLabel,
        });
      }
      subtotalCents += addonNet;
    }
  }

  // Shared platters — PER PLATTER, never per guest, never auto-discounted.
  for (const line of platters) {
    const platter = activeById(config.platters, line.platterId);
    if (!platter) {
      unresolvedNotes.push("A shared platter is unavailable.");
      continue;
    }
    const qty = Math.max(1, Math.trunc(line.quantity));
    const charge = platter.pricePerPlatterCents * qty;
    lines.push({
      label: `${platter.name} ×${qty} (shared)`,
      amountCents: charge,
      kind: "platter",
    });
    subtotalCents += charge;
  }

  return {
    lines,
    subtotalCents: Math.max(0, subtotalCents),
    hasUnresolvedRules: unresolvedNotes.length > 0,
    unresolvedNotes,
  };
}

/** The 50% deposit amount for a given subtotal. */
export function depositForSubtotal(subtotalCents: number): number {
  return roundCents(subtotalCents * 0.5);
}
