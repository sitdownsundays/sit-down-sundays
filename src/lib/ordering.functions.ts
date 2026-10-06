/**
 * Ordering model — authenticated server functions (thin client-safe wrappers).
 *
 * Components import these (NOT the *.server.ts helpers). The build replaces
 * their implementations with RPC stubs in client bundles, so server-only
 * modules, secrets, and the service-role client never enter the client
 * dependency graph.
 *
 * AUTHORIZATION:
 *  - Every config read or mutation resolves the CURRENT server-side Supabase
 *    user via resolveOrderingActor() (auth.getUser() — never trusting decoded
 *    cookies or a browser-supplied role). The actor's role is the only role
 *    that reaches the ordering repository.
 *  - Config mutations require menus.manage (content_manager, ops_manager,
 *    administrator). Guest and unauthenticated requests are rejected.
 *  - The preview tool allows foh_staff (read-only) via resolveOrderingPreviewActor.
 *  - Raw Supabase errors, credentials, and stack traces are never exposed.
 */
import { createServerFn } from "@tanstack/react-start";
import { getOrderingRepository } from "@/lib/server/ordering-repository.server";
import {
  resolveOrderingActor,
  resolveOrderingPreviewActor,
} from "@/lib/server/ordering-auth.server";
import {
  createMealPackageSchema,
  updateMealPackageSchema,
  createIndividualAddonSchema,
  updateIndividualAddonSchema,
  createSharedPlatterSchema,
  updateSharedPlatterSchema,
  updateGuestPricingRulesSchema,
} from "@/lib/ordering/schema";
import type {
  MealPackageOperationResult,
  IndividualAddonOperationResult,
  SharedPlatterOperationResult,
  GuestPricingRulesOperationResult,
  OrderingConfigDTO,
} from "@/lib/ordering/types";

/* ----------------------------- Config reads ----------------------------- */

export const getOrderingConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: true; config: OrderingConfigDTO } | { ok: false; error: string }> => {
    try {
      // Preview tool allows foh_staff read-only; config management requires menus.manage.
      await resolveOrderingPreviewActor();
      const repo = getOrderingRepository();
      const config = await repo.getOrderingConfig();
      return { ok: true, config };
    } catch {
      return { ok: false, error: "You are not authorized to view ordering configuration." };
    }
  },
);

/* ----------------------------- Packages ----------------------------- */

export const createMealPackage = createServerFn({ method: "POST" })
  .validator((d: unknown) => createMealPackageSchema.parse(d))
  .handler(async ({ data }): Promise<MealPackageOperationResult> => {
    try {
      const actor = await resolveOrderingActor();
      const repo = getOrderingRepository();
      return await repo.createPackage(actor.userId, data);
    } catch {
      return { success: false, error: "You are not authorized to manage ordering configuration." };
    }
  });

export const updateMealPackage = createServerFn({ method: "POST" })
  .validator((d: unknown) => updateMealPackageSchema.parse(d))
  .handler(async ({ data }): Promise<MealPackageOperationResult> => {
    try {
      const actor = await resolveOrderingActor();
      const repo = getOrderingRepository();
      return await repo.updatePackage(actor.userId, data);
    } catch {
      return { success: false, error: "You are not authorized to manage ordering configuration." };
    }
  });

/* ----------------------------- Add-ons ----------------------------- */

export const createIndividualAddon = createServerFn({ method: "POST" })
  .validator((d: unknown) => createIndividualAddonSchema.parse(d))
  .handler(async ({ data }): Promise<IndividualAddonOperationResult> => {
    try {
      const actor = await resolveOrderingActor();
      const repo = getOrderingRepository();
      return await repo.createAddon(actor.userId, data);
    } catch {
      return { success: false, error: "You are not authorized to manage ordering configuration." };
    }
  });

export const updateIndividualAddon = createServerFn({ method: "POST" })
  .validator((d: unknown) => updateIndividualAddonSchema.parse(d))
  .handler(async ({ data }): Promise<IndividualAddonOperationResult> => {
    try {
      const actor = await resolveOrderingActor();
      const repo = getOrderingRepository();
      return await repo.updateAddon(actor.userId, data);
    } catch {
      return { success: false, error: "You are not authorized to manage ordering configuration." };
    }
  });

/* ----------------------------- Platters ----------------------------- */

export const createSharedPlatter = createServerFn({ method: "POST" })
  .validator((d: unknown) => createSharedPlatterSchema.parse(d))
  .handler(async ({ data }): Promise<SharedPlatterOperationResult> => {
    try {
      const actor = await resolveOrderingActor();
      const repo = getOrderingRepository();
      return await repo.createPlatter(actor.userId, data);
    } catch {
      return { success: false, error: "You are not authorized to manage ordering configuration." };
    }
  });

export const updateSharedPlatter = createServerFn({ method: "POST" })
  .validator((d: unknown) => updateSharedPlatterSchema.parse(d))
  .handler(async ({ data }): Promise<SharedPlatterOperationResult> => {
    try {
      const actor = await resolveOrderingActor();
      const repo = getOrderingRepository();
      return await repo.updatePlatter(actor.userId, data);
    } catch {
      return { success: false, error: "You are not authorized to manage ordering configuration." };
    }
  });

/* ----------------------------- Guest pricing rules ----------------------------- */

export const updateGuestPricingRules = createServerFn({ method: "POST" })
  .validator((d: unknown) => updateGuestPricingRulesSchema.parse(d))
  .handler(async ({ data }): Promise<GuestPricingRulesOperationResult> => {
    try {
      const actor = await resolveOrderingActor();
      const repo = getOrderingRepository();
      return await repo.updateGuestPricingRules(actor.userId, data);
    } catch {
      return { success: false, error: "You are not authorized to manage ordering configuration." };
    }
  });

/* ----------------------------- Order preview ----------------------------- */

import { z } from "zod";
import { calculateOrder, depositForSubtotal } from "@/lib/ordering/pricing";

const previewGuestSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["adult", "senior", "child"]),
  name: z.string().optional(),
  packageId: z.string().min(1),
  includedSelections: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        selectionCategory: z.string(),
      }),
    )
    .optional()
    .default([]),
  addons: z
    .array(z.object({ addonId: z.string().min(1), quantity: z.number().int().min(0) }))
    .optional()
    .default([]),
});

const previewInputSchema = z.object({
  guests: z.array(previewGuestSchema),
  platters: z
    .array(z.object({ platterId: z.string().min(1), quantity: z.number().int().min(0) }))
    .optional()
    .default([]),
});

export interface OrderPreviewResult {
  success: boolean;
  lines: Array<{ label: string; amountCents: number; kind: string }>;
  subtotalCents: number;
  depositCents: number;
  hasUnresolvedRules: boolean;
  unresolvedNotes: string[];
  error?: string;
}

export const calculateOrderPreview = createServerFn({ method: "POST" })
  .validator((d: unknown) => previewInputSchema.parse(d))
  .handler(async ({ data }): Promise<OrderPreviewResult> => {
    try {
      // Preview allows foh_staff (read-only) plus config managers.
      await resolveOrderingPreviewActor();
      const repo = getOrderingRepository();
      const config = await repo.getOrderingConfig();
      const result = calculateOrder(data.guests, data.platters, {
        packages: config.packages,
        addons: config.addons,
        platters: config.platters,
        rules: config.guestPricingRules ?? {
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
        },
      });
      return {
        success: true,
        lines: result.lines.map((l) => ({
          label: l.label,
          amountCents: l.amountCents,
          kind: l.kind,
        })),
        subtotalCents: result.subtotalCents,
        depositCents: depositForSubtotal(result.subtotalCents),
        hasUnresolvedRules: result.hasUnresolvedRules,
        unresolvedNotes: result.unresolvedNotes,
      };
    } catch {
      return {
        success: false,
        lines: [],
        subtotalCents: 0,
        depositCents: 0,
        hasUnresolvedRules: true,
        unresolvedNotes: [],
        error: "You are not authorized to preview orders, or configuration is unavailable.",
      };
    }
  });
