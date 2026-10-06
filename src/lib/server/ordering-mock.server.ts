/**
 * SERVER-ONLY — mock ordering repository for local development.
 *
 * In-memory data that mirrors the migration seed. Behaves predictably for
 * development WITHOUT pretending to be persistent production data. Mock mode
 * is permitted only in local development; production uses SupabaseOrderingRepository.
 */
import type { IOrderingRepository } from "./ordering-repository-interface.server";
import type {
  MealPackageDTO,
  CreateMealPackageInput,
  UpdateMealPackageInput,
  MealPackageOperationResult,
  IndividualAddonDTO,
  CreateIndividualAddonInput,
  UpdateIndividualAddonInput,
  IndividualAddonOperationResult,
  SharedPlatterDTO,
  CreateSharedPlatterInput,
  UpdateSharedPlatterInput,
  SharedPlatterOperationResult,
  GuestPricingRulesDTO,
  UpdateGuestPricingRulesInput,
  GuestPricingRulesOperationResult,
  OrderingConfigDTO,
  EligibleItemDTO,
} from "@/lib/ordering/types";
import { MOCK_MENU_ITEMS } from "@/lib/mock/data";

/**
 * Resolve a human-readable menu-item name for an eligible-item reference.
 * Falls back to the raw id when the catalog item is not found (e.g. a test
 * fixture), so the preview never shows a blank label.
 */
function menuItemNameFor(id: string): string {
  return MOCK_MENU_ITEMS.find((m) => m.id === id)?.name ?? id;
}

let nowSeq = 0;
const now = () => {
  // Monotonic: guarantees successive calls never collide, so optimistic
  // concurrency (expectedUpdatedAt) is detectable even within one ms.
  nowSeq += 1;
  return new Date().toISOString().replace("Z", `${nowSeq.toString().padStart(3, "0")}Z`);
};

/** Stable IDs for seeded mock packages. */
const PKG_BASIC = "00000000-0000-4000-8000-000000000b01";
const PKG_SIG = "00000000-0000-4000-8000-000000000b02";
const PKG_PREM = "00000000-0000-4000-8000-000000000b03";
const RULES_ID = "00000000-0000-4000-8000-0000000090701";

function seedPackages(): MealPackageDTO[] {
  const mk = (
    id: string,
    name: string,
    slug: string,
    price: number,
    meats: number,
    sides: number,
    desc: string,
  ): MealPackageDTO => ({
    id,
    name,
    slug,
    description: desc,
    pricePerPersonCents: price,
    includedMeatsCount: meats,
    includedSidesCount: sides,
    includesBread: true,
    includesSoftDrink: true,
    isActive: true,
    displayOrder: price,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    eligibleItems: [],
  });
  return [
    mk(
      PKG_BASIC,
      "Basic Meal",
      "basic-meal",
      2950,
      2,
      2,
      "Two meats, two sides, rolls or cornbread, and a soft drink.",
    ),
    mk(
      PKG_SIG,
      "Signature Meal",
      "signature-meal",
      3450,
      2,
      2,
      "Two meats with expanded options, two sides, rolls or cornbread, and a soft drink.",
    ),
    mk(
      PKG_PREM,
      "Premium Meal",
      "premium-meal",
      4450,
      2,
      3,
      "Two premium meat choices, three sides, rolls or cornbread, and a soft drink.",
    ),
  ];
}

function seedRules(): GuestPricingRulesDTO {
  return {
    seniorDiscountPercent: 5,
    seniorMinAge: null,
    seniorAppliesToPackages: true,
    seniorAppliesToAddons: false,
    seniorAppliesToPlatters: false,
    childRuleType: "none",
    childDiscountPercent: null,
    childFixedPackagePriceCents: null,
    childMaxAge: null,
    childAppliesToPackages: true,
    childAppliesToAddons: false,
    childAppliesToPlatters: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export class MockOrderingRepository implements IOrderingRepository {
  private packages: MealPackageDTO[] = seedPackages();
  private addons: IndividualAddonDTO[] = [];
  private platters: SharedPlatterDTO[] = [];
  private rules: GuestPricingRulesDTO = seedRules();

  async listPackages(): Promise<MealPackageDTO[]> {
    return [...this.packages].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async createPackage(
    actorUserId: string,
    input: CreateMealPackageInput,
  ): Promise<MealPackageOperationResult> {
    if (this.packages.some((p) => p.slug === input.slug)) {
      return { success: false, error: "A package with this slug already exists." };
    }
    const pkg: MealPackageDTO = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      pricePerPersonCents: input.pricePerPersonCents,
      includedMeatsCount: input.includedMeatsCount,
      includedSidesCount: input.includedSidesCount,
      includesBread: input.includesBread ?? false,
      includesSoftDrink: input.includesSoftDrink ?? false,
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now(),
      updatedAt: now(),
      createdBy: actorUserId,
      updatedBy: actorUserId,
      eligibleItems: (input.eligibleItems ?? []).map((e) => ({
        id: crypto.randomUUID(),
        packageId: "",
        menuItemId: e.menuItemId,
        menuItemName: menuItemNameFor(e.menuItemId),
        selectionCategory: e.selectionCategory,
      })),
    };
    pkg.eligibleItems.forEach((e) => (e.packageId = pkg.id));
    this.packages.push(pkg);
    return { success: true, data: { ...pkg } };
  }

  async updatePackage(
    actorUserId: string,
    input: UpdateMealPackageInput,
  ): Promise<MealPackageOperationResult> {
    const idx = this.packages.findIndex((p) => p.id === input.id);
    if (idx === -1) return { success: false, error: "Package not found." };
    const existing = this.packages[idx];
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This package was modified by another user. Reload the latest data.",
      };
    }
    if (
      input.slug &&
      input.slug !== existing.slug &&
      this.packages.some((p) => p.slug === input.slug && p.id !== input.id)
    ) {
      return { success: false, error: "A package with this slug already exists." };
    }
    const updated: MealPackageDTO = {
      ...existing,
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      description: input.description !== undefined ? input.description : existing.description,
      pricePerPersonCents: input.pricePerPersonCents ?? existing.pricePerPersonCents,
      includedMeatsCount: input.includedMeatsCount ?? existing.includedMeatsCount,
      includedSidesCount: input.includedSidesCount ?? existing.includedSidesCount,
      includesBread: input.includesBread ?? existing.includesBread,
      includesSoftDrink: input.includesSoftDrink ?? existing.includesSoftDrink,
      isActive: input.isActive ?? existing.isActive,
      displayOrder: input.displayOrder ?? existing.displayOrder,
      updatedAt: now(),
      updatedBy: actorUserId,
      eligibleItems:
        input.eligibleItems !== undefined
          ? input.eligibleItems.map((e) => ({
              id: crypto.randomUUID(),
              packageId: existing.id,
              menuItemId: e.menuItemId,
              menuItemName: menuItemNameFor(e.menuItemId),
              selectionCategory: e.selectionCategory,
            }))
          : existing.eligibleItems,
    };
    this.packages[idx] = updated;
    return { success: true, data: { ...updated } };
  }

  async listAddons(): Promise<IndividualAddonDTO[]> {
    return [...this.addons].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async createAddon(
    actorUserId: string,
    input: CreateIndividualAddonInput,
  ): Promise<IndividualAddonOperationResult> {
    if (this.addons.some((a) => a.slug === input.slug)) {
      return { success: false, error: "An add-on with this slug already exists." };
    }
    const addon: IndividualAddonDTO = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      priceCents: input.priceCents,
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now(),
      updatedAt: now(),
      createdBy: actorUserId,
      updatedBy: actorUserId,
      eligiblePackageIds: input.eligiblePackageIds ?? [],
    };
    this.addons.push(addon);
    return { success: true, data: { ...addon } };
  }

  async updateAddon(
    actorUserId: string,
    input: UpdateIndividualAddonInput,
  ): Promise<IndividualAddonOperationResult> {
    const idx = this.addons.findIndex((a) => a.id === input.id);
    if (idx === -1) return { success: false, error: "Add-on not found." };
    const existing = this.addons[idx];
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This add-on was modified by another user. Reload the latest data.",
      };
    }
    if (
      input.slug &&
      input.slug !== existing.slug &&
      this.addons.some((a) => a.slug === input.slug && a.id !== input.id)
    ) {
      return { success: false, error: "An add-on with this slug already exists." };
    }
    const updated: IndividualAddonDTO = {
      ...existing,
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      description: input.description !== undefined ? input.description : existing.description,
      priceCents: input.priceCents ?? existing.priceCents,
      isActive: input.isActive ?? existing.isActive,
      displayOrder: input.displayOrder ?? existing.displayOrder,
      eligiblePackageIds:
        input.eligiblePackageIds !== undefined
          ? input.eligiblePackageIds
          : existing.eligiblePackageIds,
      updatedAt: now(),
      updatedBy: actorUserId,
    };
    this.addons[idx] = updated;
    return { success: true, data: { ...updated } };
  }

  async listPlatters(): Promise<SharedPlatterDTO[]> {
    return [...this.platters].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async createPlatter(
    actorUserId: string,
    input: CreateSharedPlatterInput,
  ): Promise<SharedPlatterOperationResult> {
    if (this.platters.some((p) => p.slug === input.slug)) {
      return { success: false, error: "A platter with this slug already exists." };
    }
    const platter: SharedPlatterDTO = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      pricePerPlatterCents: input.pricePerPlatterCents,
      servingGuidance: input.servingGuidance ?? null,
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now(),
      updatedAt: now(),
      createdBy: actorUserId,
      updatedBy: actorUserId,
    };
    this.platters.push(platter);
    return { success: true, data: { ...platter } };
  }

  async updatePlatter(
    actorUserId: string,
    input: UpdateSharedPlatterInput,
  ): Promise<SharedPlatterOperationResult> {
    const idx = this.platters.findIndex((p) => p.id === input.id);
    if (idx === -1) return { success: false, error: "Platter not found." };
    const existing = this.platters[idx];
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This platter was modified by another user. Reload the latest data.",
      };
    }
    if (
      input.slug &&
      input.slug !== existing.slug &&
      this.platters.some((p) => p.slug === input.slug && p.id !== input.id)
    ) {
      return { success: false, error: "A platter with this slug already exists." };
    }
    const updated: SharedPlatterDTO = {
      ...existing,
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      description: input.description !== undefined ? input.description : existing.description,
      pricePerPlatterCents: input.pricePerPlatterCents ?? existing.pricePerPlatterCents,
      servingGuidance:
        input.servingGuidance !== undefined ? input.servingGuidance : existing.servingGuidance,
      isActive: input.isActive ?? existing.isActive,
      displayOrder: input.displayOrder ?? existing.displayOrder,
      updatedAt: now(),
      updatedBy: actorUserId,
    };
    this.platters[idx] = updated;
    return { success: true, data: { ...updated } };
  }

  async getGuestPricingRules(): Promise<GuestPricingRulesDTO | null> {
    return { ...this.rules };
  }

  async updateGuestPricingRules(
    actorUserId: string,
    input: UpdateGuestPricingRulesInput,
  ): Promise<GuestPricingRulesOperationResult> {
    if (this.rules.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "These rules were modified by another user. Reload the latest data.",
      };
    }
    const updated: GuestPricingRulesDTO = {
      seniorDiscountPercent: input.seniorDiscountPercent,
      seniorMinAge: input.seniorMinAge,
      seniorAppliesToPackages: input.seniorAppliesToPackages ?? true,
      seniorAppliesToAddons: input.seniorAppliesToAddons ?? false,
      seniorAppliesToPlatters: input.seniorAppliesToPlatters ?? false,
      childRuleType: input.childRuleType,
      childDiscountPercent: input.childDiscountPercent,
      childFixedPackagePriceCents: input.childFixedPackagePriceCents,
      childMaxAge: input.childMaxAge,
      childAppliesToPackages: input.childAppliesToPackages ?? true,
      childAppliesToAddons: input.childAppliesToAddons ?? false,
      childAppliesToPlatters: input.childAppliesToPlatters ?? false,
      updatedAt: now(),
    };
    this.rules = updated;
    return { success: true, data: { ...updated } };
  }

  async getOrderingConfig(): Promise<OrderingConfigDTO> {
    return {
      packages: await this.listPackages(),
      addons: await this.listAddons(),
      platters: await this.listPlatters(),
      guestPricingRules: await this.getGuestPricingRules(),
    };
  }
}
