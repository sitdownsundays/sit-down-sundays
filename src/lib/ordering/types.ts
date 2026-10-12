/**
 * Ordering model — DTOs and operation inputs.
 *
 * Independent of the Menu CMS and the future booking/reservation engine.
 * Client-safe: no server-only imports, no mock data.
 *
 * Packages are priced PER PERSON. Included dishes are covered by the
 * package price and must NOT be charged again. Individual add-ons are
 * priced per unit and attached to one guest. Shared platters are priced
 * PER PLATTER and belong to the party order, never multiplied by guest
 * count. Senior/child discounts do NOT apply to shared platters automatically.
 */
import type { SelectionCategory, ChildRuleType } from "./constants";

/** A menu_item eligible for a package's included-selection bucket. */
export interface EligibleItemDTO {
  id: string;
  packageId: string;
  menuItemId: string;
  /** Menu-item name snapshot for display (resolved from menu_items). */
  menuItemName: string;
  selectionCategory: SelectionCategory;
}

export interface MealPackageDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** Per-person package price in integer cents. */
  pricePerPersonCents: number;
  includedMeatsCount: number;
  includedSidesCount: number;
  includesBread: boolean;
  includesSoftDrink: boolean;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  eligibleItems: EligibleItemDTO[];
  /**
   * Package-specific child pricing override.
   * null = use the existing global child-pricing behavior (not configured).
   * "none" = explicitly charge this package's regular price (no discount).
   * "fixed_package_price" = charge childFixedPriceCents.
   * "percentage_discount" = reduce by childDiscountBasisPoints.
   */
  childRuleType: ChildRuleType | null;
  /** Final child package price in cents. Required for fixed_package_price; null otherwise. */
  childFixedPriceCents: number | null;
  /** Child discount in basis points (100 = 1%). Required for percentage_discount; null otherwise. */
  childDiscountBasisPoints: number | null;
  /**
   * Package-specific senior pricing override (same semantics as childRuleType).
   * Independent of the global senior rule and the per-package child rule.
   */
  seniorRuleType: ChildRuleType | null;
  /** Final senior package price in cents. Required for fixed_package_price; null otherwise. */
  seniorFixedPriceCents: number | null;
  /** Senior discount in basis points (100 = 1%). Required for percentage_discount; null otherwise. */
  seniorDiscountBasisPoints: number | null;
}

export interface CreateMealPackageInput {
  name: string;
  slug: string;
  description?: string;
  pricePerPersonCents: number;
  includedMeatsCount: number;
  includedSidesCount: number;
  includesBread?: boolean;
  includesSoftDrink?: boolean;
  isActive?: boolean;
  displayOrder?: number;
  /** When provided, replaces the eligible-item set. */
  eligibleItems?: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>;
}

export interface UpdateMealPackageInput {
  id: string;
  /** Required for optimistic-concurrency protection. */
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  description?: string;
  pricePerPersonCents?: number;
  includedMeatsCount?: number;
  includedSidesCount?: number;
  includesBread?: boolean;
  includesSoftDrink?: boolean;
  isActive?: boolean;
  displayOrder?: number;
  /** When provided, replaces the eligible-item set. */
  eligibleItems?: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>;
}

export interface MealPackageOperationResult {
  success: boolean;
  data?: MealPackageDTO;
  error?: string;
  conflict?: boolean;
}

export interface IndividualAddonDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** Per-unit price in integer cents. */
  priceCents: number;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  /**
   * Package IDs this add-on may be ordered with. Empty means eligible for all
   * active packages (interpreted in the application layer).
   */
  eligiblePackageIds: string[];
}

export interface CreateIndividualAddonInput {
  name: string;
  slug: string;
  description?: string;
  priceCents: number;
  isActive?: boolean;
  displayOrder?: number;
  eligiblePackageIds?: string[];
}

export interface UpdateIndividualAddonInput {
  id: string;
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  description?: string;
  priceCents?: number;
  isActive?: boolean;
  displayOrder?: number;
  eligiblePackageIds?: string[];
}

export interface IndividualAddonOperationResult {
  success: boolean;
  data?: IndividualAddonDTO;
  error?: string;
  conflict?: boolean;
}

export interface SharedPlatterDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** Price PER PLATTER in integer cents (never per guest). */
  pricePerPlatterCents: number;
  servingGuidance: string | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CreateSharedPlatterInput {
  name: string;
  slug: string;
  description?: string;
  pricePerPlatterCents: number;
  servingGuidance?: string | null;
  isActive?: boolean;
  displayOrder?: number;
}

export interface UpdateSharedPlatterInput {
  id: string;
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  description?: string;
  pricePerPlatterCents?: number;
  servingGuidance?: string | null;
  isActive?: boolean;
  displayOrder?: number;
}

export interface SharedPlatterOperationResult {
  success: boolean;
  data?: SharedPlatterDTO;
  error?: string;
  conflict?: boolean;
}

export interface GuestPricingRulesDTO {
  seniorDiscountPercent: number | null;
  seniorMinAge: number | null;
  seniorAppliesToPackages: boolean;
  seniorAppliesToAddons: boolean;
  seniorAppliesToPlatters: boolean;
  childRuleType: ChildRuleType;
  childDiscountPercent: number | null;
  childFixedPackagePriceCents: number | null;
  childMaxAge: number | null;
  childAppliesToPackages: boolean;
  childAppliesToAddons: boolean;
  childAppliesToPlatters: boolean;
  updatedAt: string;
}

export interface UpdateGuestPricingRulesInput {
  expectedUpdatedAt: string;
  seniorDiscountPercent: number | null;
  seniorMinAge: number | null;
  seniorAppliesToPackages?: boolean;
  seniorAppliesToAddons?: boolean;
  seniorAppliesToPlatters?: boolean;
  childRuleType: ChildRuleType;
  childDiscountPercent: number | null;
  childFixedPackagePriceCents: number | null;
  childMaxAge: number | null;
  childAppliesToPackages?: boolean;
  childAppliesToAddons?: boolean;
  childAppliesToPlatters?: boolean;
}

export interface GuestPricingRulesOperationResult {
  success: boolean;
  data?: GuestPricingRulesDTO;
  error?: string;
  conflict?: boolean;
}

/** Full ordering configuration snapshot, returned together for the preview tool. */
export interface OrderingConfigDTO {
  packages: MealPackageDTO[];
  addons: IndividualAddonDTO[];
  platters: SharedPlatterDTO[];
  guestPricingRules: GuestPricingRulesDTO | null;
}
