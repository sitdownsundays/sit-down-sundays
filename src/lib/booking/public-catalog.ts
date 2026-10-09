/**
 * Public ordering catalog — customer-facing projection of the ordering config.
 *
 * Strips admin-only fields (audit actors, timestamps, slugs, internal flags)
 * from OrderingConfigDTO so the /book wizard's "Meals & extras" step receives
 * only the active catalog and public guest-pricing rules it needs.
 *
 * Client-safe: no server-only imports, no Supabase, no mock data.
 */
import type {
  OrderingConfigDTO,
  MealPackageDTO,
  IndividualAddonDTO,
  SharedPlatterDTO,
  GuestPricingRulesDTO,
  EligibleItemDTO,
} from "@/lib/ordering/types";
import type { SelectionCategory, ChildRuleType } from "@/lib/ordering/constants";

export interface PublicEligibleItem {
  menuItemId: string;
  menuItemName: string;
  selectionCategory: SelectionCategory;
}

export interface PublicMealPackage {
  id: string;
  name: string;
  description: string;
  pricePerPersonCents: number;
  includedMeatsCount: number;
  includedSidesCount: number;
  includesBread: boolean;
  includesSoftDrink: boolean;
  displayOrder: number;
  eligibleItems: PublicEligibleItem[];
}

export interface PublicIndividualAddon {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  displayOrder: number;
  eligiblePackageIds: string[];
}

export interface PublicSharedPlatter {
  id: string;
  name: string;
  description: string;
  pricePerPlatterCents: number;
  servingGuidance: string | null;
  displayOrder: number;
}

export interface PublicGuestPricingRules {
  seniorDiscountPercent: number | null;
  seniorMinAge: number | null;
  seniorAppliesToPackages: boolean;
  seniorAppliesToAddons: boolean;
  childRuleType: ChildRuleType;
  childDiscountPercent: number | null;
  childFixedPackagePriceCents: number | null;
  childMaxAge: number | null;
  childAppliesToPackages: boolean;
  childAppliesToAddons: boolean;
}

export interface PublicOrderingCatalog {
  packages: PublicMealPackage[];
  addons: PublicIndividualAddon[];
  platters: PublicSharedPlatter[];
  guestPricingRules: PublicGuestPricingRules | null;
}

function toPublicPackage(pkg: MealPackageDTO): PublicMealPackage {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    pricePerPersonCents: pkg.pricePerPersonCents,
    includedMeatsCount: pkg.includedMeatsCount,
    includedSidesCount: pkg.includedSidesCount,
    includesBread: pkg.includesBread,
    includesSoftDrink: pkg.includesSoftDrink,
    displayOrder: pkg.displayOrder,
    eligibleItems: pkg.eligibleItems.map(toPublicEligibleItem),
  };
}

function toPublicEligibleItem(e: EligibleItemDTO): PublicEligibleItem {
  return {
    menuItemId: e.menuItemId,
    menuItemName: e.menuItemName,
    selectionCategory: e.selectionCategory,
  };
}

function toPublicAddon(a: IndividualAddonDTO): PublicIndividualAddon {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    priceCents: a.priceCents,
    displayOrder: a.displayOrder,
    eligiblePackageIds: a.eligiblePackageIds,
  };
}

function toPublicPlatter(p: SharedPlatterDTO): PublicSharedPlatter {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    pricePerPlatterCents: p.pricePerPlatterCents,
    servingGuidance: p.servingGuidance,
    displayOrder: p.displayOrder,
  };
}

function toPublicRules(r: GuestPricingRulesDTO): PublicGuestPricingRules {
  return {
    seniorDiscountPercent: r.seniorDiscountPercent,
    seniorMinAge: r.seniorMinAge,
    seniorAppliesToPackages: r.seniorAppliesToPackages,
    seniorAppliesToAddons: r.seniorAppliesToAddons,
    childRuleType: r.childRuleType,
    childDiscountPercent: r.childDiscountPercent,
    childFixedPackagePriceCents: r.childFixedPackagePriceCents,
    childMaxAge: r.childMaxAge,
    childAppliesToPackages: r.childAppliesToPackages,
    childAppliesToAddons: r.childAppliesToAddons,
  };
}

/**
 * Project the full admin ordering config into the customer-facing catalog.
 * Only ACTIVE items are included; admin-only fields are stripped.
 */
export function toPublicCatalog(config: OrderingConfigDTO): PublicOrderingCatalog {
  return {
    packages: config.packages.filter((p) => p.isActive).map(toPublicPackage),
    addons: config.addons.filter((a) => a.isActive).map(toPublicAddon),
    platters: config.platters.filter((p) => p.isActive).map(toPublicPlatter),
    guestPricingRules: config.guestPricingRules ? toPublicRules(config.guestPricingRules) : null,
  };
}
