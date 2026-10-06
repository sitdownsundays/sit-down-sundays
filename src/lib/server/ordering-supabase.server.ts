/**
 * SERVER-ONLY — Supabase ordering repository (service-role).
 *
 * Reads and writes the ordering config tables established in
 * 0009_ordering_model.sql using the administrative client (bypasses RLS).
 * The caller (server actions) MUST have already verified the actor's role
 * before invoking any method — this repository does NOT authorize.
 *
 * Atomic operations: package/addon CREATION and UPDATE, plus platter and
 * guest-pricing-rules UPDATE, go through service-role-only PostgreSQL RPCs
 * (create_package_atomic, update_package_atomic, etc.) so the parent-row
 * insert/update, child-link replacement, and audit-log trigger all succeed
 * or fail in ONE transaction. This fixes the previous non-atomic
 * two-statement creation pattern that could leave an orphaned parent row
 * with no eligible items when the eligibility insert failed. Optimistic
 * concurrency is enforced INSIDE the UPDATE RPCs via
 * WHERE updated_at = p_expected_updated_at, so a stale edit updates zero
 * rows and returns a safe conflict — not a silent overwrite. Eligibility-write
 * errors are surfaced (the RPC returns a code), never silently swallowed.
 *
 * Nullable-field clearing: nullable pricing-rule values and platter serving
 * guidance distinguish "omit" from "clear to null". For platters, the
 * repository passes a sentinel (p_clear_serving_guidance) when the caller
 * explicitly sets servingGuidance to null. For guest pricing rules, the
 * repository builds a JSON object (p_fields) containing only the keys the
 * caller supplied; the RPC checks key presence (p_fields ? 'key') so an
 * explicit null clears the column while an absent key preserves the value.
 *
 * Read-error handling: list/get methods THROW on database errors instead of
 * returning an empty success result, so the caller can show an error/retry
 * state rather than a misleading "no data" screen.
 *
 * Raw Supabase errors are never returned to the browser; a safe generic
 * message is returned instead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase-admin.server";
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

const SAFE_CONFLICT =
  "This record was modified by another user. Reload the latest data and try again.";

export class SupabaseOrderingRepository implements IOrderingRepository {
  private client(): SupabaseClient {
    return getAdminClient();
  }

  private safeError(label: string, code: string | undefined): { success: false; error: string } {
    console.error(`ordering.${label}:`, code ?? "unknown error");
    return { success: false, error: "Something went wrong. Please try again." };
  }

  /** Map an RPC result code to an operation result fragment. */
  private rpcCodeToError(code: string | undefined): { error: string; conflict?: boolean } {
    if (code === "conflict") return { error: SAFE_CONFLICT, conflict: true };
    if (code === "not_found") return { error: "This record no longer exists." };
    if (code === "duplicate_slug") return { error: "A record with this slug already exists." };
    if (code === "invalid_value") return { error: "One of the values you entered is not valid." };
    if (code === "invalid_reference")
      return { error: "One of the selected items could not be found." };
    if (code === "unauthorized") return { error: "You are not authorized to perform this action." };
    return { error: "Something went wrong. Please try again." };
  }

  /* ----------------------------- Packages ----------------------------- */

  async listPackages(): Promise<MealPackageDTO[]> {
    const { data, error } = await this.client()
      .from("meal_packages")
      .select("*")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });
    // THROW on read error — do not return a misleading empty success.
    if (error) {
      console.error("ordering.listPackages:", error.code);
      throw new Error("ordering.listPackages failed");
    }
    const rows = (data ?? []) as PackageRow[];
    if (rows.length === 0) return [];
    const eligible = await this.fetchEligible(rows.map((r) => r.id));
    return rows.map((r) => packageRowToDTO(r, eligible[r.id] ?? []));
  }

  private async fetchEligible(packageIds: string[]): Promise<Record<string, EligibleItemDTO[]>> {
    if (packageIds.length === 0) return {};
    const { data, error } = await this.client()
      .from("meal_package_eligible_items")
      .select("id, package_id, menu_item_id, selection_category, menu_items(name)")
      .in("package_id", packageIds);
    if (error) {
      console.error("ordering.fetchEligible:", error.code);
      throw new Error("ordering.fetchEligible failed");
    }
    const map: Record<string, EligibleItemDTO[]> = {};
    for (const row of (data ?? []) as unknown as EligibleRow[]) {
      (map[row.package_id] ??= []).push({
        id: row.id,
        packageId: row.package_id,
        menuItemId: row.menu_item_id,
        menuItemName: row.menu_items?.name ?? row.menu_item_id,
        selectionCategory: row.selection_category,
      });
    }
    return map;
  }

  async createPackage(
    actorUserId: string,
    input: CreateMealPackageInput,
  ): Promise<MealPackageOperationResult> {
    // Atomic creation via service-role-only RPC. Parent + eligible links + audit
    // commit or roll back together.
    const eligiblePayload = (input.eligibleItems ?? []).map((i) => ({
      menuItemId: i.menuItemId,
      selectionCategory: i.selectionCategory,
    }));

    const { data: rpcData, error } = await this.client().rpc("create_package_atomic", {
      p_actor: actorUserId,
      p_name: input.name,
      p_slug: input.slug,
      p_description: input.description ?? "",
      p_price_per_person_cents: input.pricePerPersonCents,
      p_included_meats_count: input.includedMeatsCount,
      p_included_sides_count: input.includedSidesCount,
      p_includes_bread: input.includesBread ?? false,
      p_includes_soft_drink: input.includesSoftDrink ?? false,
      p_is_active: input.isActive ?? true,
      p_display_order: input.displayOrder ?? 0,
      p_eligible_items: eligiblePayload,
    });

    if (error) return this.safeError("createPackage.rpc", error.code);
    const result = rpcData as { ok: boolean; code?: string; row?: PackageRow };
    if (!result.ok) {
      const { error: msg, conflict } = this.rpcCodeToError(result.code);
      return { success: false, error: msg, conflict };
    }
    const pkg = packageRowToDTO(result.row as PackageRow, []);
    // Re-read eligible items so the returned DTO reflects the atomic insert.
    pkg.eligibleItems = (await this.fetchEligible([pkg.id]))[pkg.id] ?? [];
    return { success: true, data: pkg };
  }

  async updatePackage(
    actorUserId: string,
    input: UpdateMealPackageInput,
  ): Promise<MealPackageOperationResult> {
    // Atomic update + eligibility replacement via service-role-only RPC.
    const eligiblePayload =
      input.eligibleItems !== undefined
        ? input.eligibleItems.map((i) => ({
            menuItemId: i.menuItemId,
            selectionCategory: i.selectionCategory,
          }))
        : null;

    const { data: rpcData, error } = await this.client().rpc("update_package_atomic", {
      p_package_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_actor: actorUserId,
      p_name: input.name ?? null,
      p_slug: input.slug ?? null,
      p_description: input.description ?? null,
      p_price_per_person_cents: input.pricePerPersonCents ?? null,
      p_included_meats_count: input.includedMeatsCount ?? null,
      p_included_sides_count: input.includedSidesCount ?? null,
      p_includes_bread: input.includesBread ?? null,
      p_includes_soft_drink: input.includesSoftDrink ?? null,
      p_is_active: input.isActive ?? null,
      p_display_order: input.displayOrder ?? null,
      p_eligible_items: eligiblePayload,
    });

    if (error) return this.safeError("updatePackage.rpc", error.code);
    const result = rpcData as { ok: boolean; code?: string; row?: PackageRow };
    if (!result.ok) {
      const { error: msg, conflict } = this.rpcCodeToError(result.code);
      return { success: false, error: msg, conflict };
    }
    const pkg = packageRowToDTO(result.row as PackageRow, []);
    // Re-read eligible items so the returned DTO reflects the atomic replacement.
    pkg.eligibleItems = (await this.fetchEligible([pkg.id]))[pkg.id] ?? [];
    return { success: true, data: pkg };
  }

  /* ----------------------------- Add-ons ----------------------------- */

  async listAddons(): Promise<IndividualAddonDTO[]> {
    const client = this.client();
    const { data, error } = await client
      .from("individual_addons")
      .select("*")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.error("ordering.listAddons:", error.code);
      throw new Error("ordering.listAddons failed");
    }
    const rows = (data ?? []) as AddonRow[];
    if (rows.length === 0) return [];
    const { data: links, error: le } = await client
      .from("addon_eligible_packages")
      .select("addon_id, package_id")
      .in(
        "addon_id",
        rows.map((r) => r.id),
      );
    if (le) {
      console.error("ordering.listAddons.links:", le.code);
      throw new Error("ordering.listAddons.links failed");
    }
    const linkMap: Record<string, string[]> = {};
    for (const l of (links ?? []) as unknown as { addon_id: string; package_id: string }[]) {
      (linkMap[l.addon_id] ??= []).push(l.package_id);
    }
    return rows.map((r) => addonRowToDTO(r, linkMap[r.id] ?? []));
  }

  async createAddon(
    actorUserId: string,
    input: CreateIndividualAddonInput,
  ): Promise<IndividualAddonOperationResult> {
    // Atomic creation via service-role-only RPC. Parent + links + audit commit
    // or roll back together.
    const linksPayload = input.eligiblePackageIds ?? [];

    const { data: rpcData, error } = await this.client().rpc("create_addon_atomic", {
      p_actor: actorUserId,
      p_name: input.name,
      p_slug: input.slug,
      p_description: input.description ?? "",
      p_price_cents: input.priceCents,
      p_is_active: input.isActive ?? true,
      p_display_order: input.displayOrder ?? 0,
      p_eligible_package_ids: linksPayload,
    });

    if (error) return this.safeError("createAddon.rpc", error.code);
    const result = rpcData as {
      ok: boolean;
      code?: string;
      row?: AddonRow;
      links?: string[];
    };
    if (!result.ok) {
      const { error: msg, conflict } = this.rpcCodeToError(result.code);
      return { success: false, error: msg, conflict };
    }
    // Use the saved links returned by the RPC (extracted server-side), not a
    // separate post-commit read.
    const addon = addonRowToDTO(result.row as AddonRow, result.links ?? []);
    return { success: true, data: addon };
  }

  async updateAddon(
    actorUserId: string,
    input: UpdateIndividualAddonInput,
  ): Promise<IndividualAddonOperationResult> {
    const linksPayload = input.eligiblePackageIds !== undefined ? input.eligiblePackageIds : null;

    const { data: rpcData, error } = await this.client().rpc("update_addon_atomic", {
      p_addon_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_actor: actorUserId,
      p_name: input.name ?? null,
      p_slug: input.slug ?? null,
      p_description: input.description ?? null,
      p_price_cents: input.priceCents ?? null,
      p_is_active: input.isActive ?? null,
      p_display_order: input.displayOrder ?? null,
      p_eligible_package_ids: linksPayload,
    });

    if (error) return this.safeError("updateAddon.rpc", error.code);
    const result = rpcData as {
      ok: boolean;
      code?: string;
      row?: AddonRow;
      links?: string[];
    };
    if (!result.ok) {
      const { error: msg, conflict } = this.rpcCodeToError(result.code);
      return { success: false, error: msg, conflict };
    }
    // Use the saved links returned by the RPC (extracted server-side), not a
    // separate post-commit read that could mask a save failure.
    const addon = addonRowToDTO(result.row as AddonRow, result.links ?? []);
    return { success: true, data: addon };
  }

  /* ----------------------------- Platters ----------------------------- */

  async listPlatters(): Promise<SharedPlatterDTO[]> {
    const { data, error } = await this.client()
      .from("shared_platters")
      .select("*")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.error("ordering.listPlatters:", error.code);
      throw new Error("ordering.listPlatters failed");
    }
    return (data ?? []).map((r: PlatterRow) => platterRowToDTO(r));
  }

  async createPlatter(
    actorUserId: string,
    input: CreateSharedPlatterInput,
  ): Promise<SharedPlatterOperationResult> {
    const { data, error } = await this.client()
      .from("shared_platters")
      .insert({
        name: input.name,
        slug: input.slug,
        description: input.description ?? "",
        price_per_platter_cents: input.pricePerPlatterCents,
        serving_guidance: input.servingGuidance ?? null,
        is_active: input.isActive ?? true,
        display_order: input.displayOrder ?? 0,
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505")
        return { success: false, error: "A platter with this slug already exists." };
      return this.safeError("createPlatter", error.code);
    }
    return { success: true, data: platterRowToDTO(data as PlatterRow) };
  }

  async updatePlatter(
    actorUserId: string,
    input: UpdateSharedPlatterInput,
  ): Promise<SharedPlatterOperationResult> {
    // Distinguish omit from clear for nullable servingGuidance:
    //   undefined  → preserve (no sentinel, no value)
    //   null       → clear   (p_clear_serving_guidance = true)
    //   string     → set     (p_serving_guidance = value)
    const clearServingGuidance = input.servingGuidance === null;
    const servingGuidanceValue =
      input.servingGuidance !== undefined && input.servingGuidance !== null
        ? input.servingGuidance
        : null;

    const { data: rpcData, error } = await this.client().rpc("update_platter_atomic", {
      p_platter_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_actor: actorUserId,
      p_name: input.name ?? null,
      p_slug: input.slug ?? null,
      p_description: input.description ?? null,
      p_price_per_platter_cents: input.pricePerPlatterCents ?? null,
      p_clear_serving_guidance: clearServingGuidance,
      p_serving_guidance: servingGuidanceValue,
      p_is_active: input.isActive ?? null,
      p_display_order: input.displayOrder ?? null,
    });

    if (error) return this.safeError("updatePlatter.rpc", error.code);
    const result = rpcData as { ok: boolean; code?: string; row?: PlatterRow };
    if (!result.ok) {
      const { error: msg, conflict } = this.rpcCodeToError(result.code);
      return { success: false, error: msg, conflict };
    }
    return { success: true, data: platterRowToDTO(result.row as PlatterRow) };
  }

  /* ----------------------------- Guest pricing rules ----------------------------- */

  async getGuestPricingRules(): Promise<GuestPricingRulesDTO | null> {
    const { data, error } = await this.client()
      .from("guest_pricing_rules")
      .select("*")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("ordering.getGuestPricingRules:", error.code);
      throw new Error("ordering.getGuestPricingRules failed");
    }
    if (!data) return null;
    return rulesRowToDTO(data as RulesRow);
  }

  async updateGuestPricingRules(
    actorUserId: string,
    input: UpdateGuestPricingRulesInput,
  ): Promise<GuestPricingRulesOperationResult> {
    // Build a JSON object containing only the keys the caller supplied. The
    // RPC checks key presence (p_fields ? 'key') so an explicit null clears
    // the column while an absent key preserves the existing value.
    //
    // Nullable number fields (seniorDiscountPercent, seniorMinAge,
    // childDiscountPercent, childFixedPackagePriceCents, childMaxAge) are
    // required in the input type, so they are always present — null clears,
    // a number sets. Optional boolean fields are present only if provided.
    const fields: Record<string, unknown> = {
      seniorDiscountPercent: input.seniorDiscountPercent,
      seniorMinAge: input.seniorMinAge,
      childRuleType: input.childRuleType,
      childDiscountPercent: input.childDiscountPercent,
      childFixedPackagePriceCents: input.childFixedPackagePriceCents,
      childMaxAge: input.childMaxAge,
    };
    if (input.seniorAppliesToPackages !== undefined)
      fields.seniorAppliesToPackages = input.seniorAppliesToPackages;
    if (input.seniorAppliesToAddons !== undefined)
      fields.seniorAppliesToAddons = input.seniorAppliesToAddons;
    if (input.seniorAppliesToPlatters !== undefined)
      fields.seniorAppliesToPlatters = input.seniorAppliesToPlatters;
    if (input.childAppliesToPackages !== undefined)
      fields.childAppliesToPackages = input.childAppliesToPackages;
    if (input.childAppliesToAddons !== undefined)
      fields.childAppliesToAddons = input.childAppliesToAddons;
    if (input.childAppliesToPlatters !== undefined)
      fields.childAppliesToPlatters = input.childAppliesToPlatters;

    const { data: rpcData, error } = await this.client().rpc("update_guest_pricing_rules_atomic", {
      p_expected_updated_at: input.expectedUpdatedAt,
      p_actor: actorUserId,
      p_fields: fields,
    });

    if (error) return this.safeError("updateGuestPricingRules.rpc", error.code);
    const result = rpcData as { ok: boolean; code?: string; row?: RulesRow };
    if (!result.ok) {
      const { error: msg, conflict } = this.rpcCodeToError(result.code);
      return { success: false, error: msg, conflict };
    }
    return { success: true, data: rulesRowToDTO(result.row as RulesRow) };
  }

  async getOrderingConfig(): Promise<OrderingConfigDTO> {
    const [packages, addons, platters, guestPricingRules] = await Promise.all([
      this.listPackages(),
      this.listAddons(),
      this.listPlatters(),
      this.getGuestPricingRules(),
    ]);
    return { packages, addons, platters, guestPricingRules };
  }
}

/* ----------------------------- Row mappers ----------------------------- */

interface PackageRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_per_person_cents: number;
  included_meats_count: number;
  included_sides_count: number;
  includes_bread: boolean;
  includes_soft_drink: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}
interface EligibleRow {
  id: string;
  package_id: string;
  menu_item_id: string;
  selection_category: "meat" | "side" | "bread" | "drink";
  menu_items?: { name: string } | null;
}
interface AddonRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_cents: number;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}
interface PlatterRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_per_platter_cents: number;
  serving_guidance: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}
interface RulesRow {
  senior_discount_percent: number | null;
  senior_min_age: number | null;
  senior_applies_to_packages: boolean;
  senior_applies_to_addons: boolean;
  senior_applies_to_platters: boolean;
  child_rule_type: "none" | "fixed_package_price" | "percentage_discount";
  child_discount_percent: number | null;
  child_fixed_package_price_cents: number | null;
  child_max_age: number | null;
  child_applies_to_packages: boolean;
  child_applies_to_addons: boolean;
  child_applies_to_platters: boolean;
  updated_at: string;
}

function packageRowToDTO(row: PackageRow, eligible: EligibleItemDTO[]): MealPackageDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    pricePerPersonCents: row.price_per_person_cents,
    includedMeatsCount: row.included_meats_count,
    includedSidesCount: row.included_sides_count,
    includesBread: row.includes_bread,
    includesSoftDrink: row.includes_soft_drink,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    eligibleItems: eligible,
  };
}
function addonRowToDTO(row: AddonRow, eligiblePackageIds: string[]): IndividualAddonDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    priceCents: row.price_cents,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    eligiblePackageIds,
  };
}
function platterRowToDTO(row: PlatterRow): SharedPlatterDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    pricePerPlatterCents: row.price_per_platter_cents,
    servingGuidance: row.serving_guidance,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}
function rulesRowToDTO(row: RulesRow): GuestPricingRulesDTO {
  return {
    seniorDiscountPercent: row.senior_discount_percent,
    seniorMinAge: row.senior_min_age,
    seniorAppliesToPackages: row.senior_applies_to_packages,
    seniorAppliesToAddons: row.senior_applies_to_addons,
    seniorAppliesToPlatters: row.senior_applies_to_platters,
    childRuleType: row.child_rule_type,
    childDiscountPercent: row.child_discount_percent,
    childFixedPackagePriceCents: row.child_fixed_package_price_cents,
    childMaxAge: row.child_max_age,
    childAppliesToPackages: row.child_applies_to_packages,
    childAppliesToAddons: row.child_applies_to_addons,
    childAppliesToPlatters: row.child_applies_to_platters,
    updatedAt: row.updated_at,
  };
}
