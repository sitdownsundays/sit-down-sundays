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
} from "@/lib/ordering/types";

/**
 * SERVER-ONLY — ordering repository contract.
 * Implementations: MockOrderingRepository (local dev), SupabaseOrderingRepository (prod).
 * The caller MUST have already verified the actor's role before calling.
 */
export interface IOrderingRepository {
  /* Packages */
  listPackages(): Promise<MealPackageDTO[]>;
  createPackage(
    actorUserId: string,
    input: CreateMealPackageInput,
  ): Promise<MealPackageOperationResult>;
  updatePackage(
    actorUserId: string,
    input: UpdateMealPackageInput,
  ): Promise<MealPackageOperationResult>;

  /* Individual add-ons */
  listAddons(): Promise<IndividualAddonDTO[]>;
  createAddon(
    actorUserId: string,
    input: CreateIndividualAddonInput,
  ): Promise<IndividualAddonOperationResult>;
  updateAddon(
    actorUserId: string,
    input: UpdateIndividualAddonInput,
  ): Promise<IndividualAddonOperationResult>;

  /* Shared platters */
  listPlatters(): Promise<SharedPlatterDTO[]>;
  createPlatter(
    actorUserId: string,
    input: CreateSharedPlatterInput,
  ): Promise<SharedPlatterOperationResult>;
  updatePlatter(
    actorUserId: string,
    input: UpdateSharedPlatterInput,
  ): Promise<SharedPlatterOperationResult>;

  /* Guest pricing rules (singleton config) */
  getGuestPricingRules(): Promise<GuestPricingRulesDTO | null>;
  updateGuestPricingRules(
    actorUserId: string,
    input: UpdateGuestPricingRulesInput,
  ): Promise<GuestPricingRulesOperationResult>;

  /** Full config snapshot for the preview tool (all active + rules). */
  getOrderingConfig(): Promise<OrderingConfigDTO>;
}
