/**
 * SERVER-ONLY — trusted order snapshot builder.
 *
 * Accepts validated reservation selections + authoritative ordering
 * configuration and produces typed persistence snapshots for BOTH the mock
 * and Supabase repositories. The 0011 RPC expects enriched JSON (package
 * name/price, included dish names, addon name/price, platter name/price);
 * the repository input otherwise only carries IDs and quantities.
 *
 * Rules:
 *  - No client-supplied names/prices become trusted snapshots. Names and
 *    prices are resolved exclusively from the authoritative config.
 *  - Unknown or unavailable referenced items produce a safe error (the
 *    submission is rejected, never persisted with placeholder data).
 *  - Actual included dish names are preserved (alongside IDs/categories) so
 *    kitchen/admin display remains accurate after catalog changes.
 *  - Per-unit catalog prices are preserved separately from calculated
 *    discounts/totals (the pricing engine handles discounts).
 *  - Reuses the existing pricing result; this builder does NOT recompute
 *    totals. Updating catalog data later does not change a saved snapshot
 *    because snapshots are immutable strings/numbers captured here.
 *  - Fetches config once (the caller passes the already-loaded config); this
 *    builder does not re-fetch to avoid inconsistent configuration.
 */
import type {
  OrderingConfigDTO,
  MealPackageDTO,
  IndividualAddonDTO,
  SharedPlatterDTO,
} from "@/lib/ordering/types";
import type { ReservationGuestInput, ReservationPlatterInput } from "@/lib/reservation/types";

export interface IncludedSelectionSnapshot {
  menuItemId: string;
  name: string;
  category: string;
}

export interface GuestAddonSnapshot {
  addonId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface ReservationGuestSnapshot {
  guestIndex: number;
  category: string;
  name: string;
  packageId: string;
  packageName: string;
  packagePrice: number;
  included: IncludedSelectionSnapshot[];
  addons: GuestAddonSnapshot[];
}

export interface ReservationPlatterSnapshot {
  platterId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface ReservationSnapshots {
  guests: ReservationGuestSnapshot[];
  platters: ReservationPlatterSnapshot[];
}

/**
 * Build trusted persistence snapshots from validated selections and
 * authoritative ordering configuration. Throws a safe, secret-free Error if
 * any referenced item is unknown or inactive.
 */
export function buildReservationSnapshots(
  guests: ReservationGuestInput[],
  platters: ReservationPlatterInput[],
  config: OrderingConfigDTO,
): ReservationSnapshots {
  const packageById = new Map<string, MealPackageDTO>();
  for (const p of config.packages) packageById.set(p.id, p);
  const addonById = new Map<string, IndividualAddonDTO>();
  for (const a of config.addons) addonById.set(a.id, a);
  const platterById = new Map<string, SharedPlatterDTO>();
  for (const p of config.platters) platterById.set(p.id, p);

  const guestSnapshots: ReservationGuestSnapshot[] = guests.map((g) => {
    const pkg = packageById.get(g.packageId);
    if (!pkg || !pkg.isActive) {
      throw new Error("A selected meal package is no longer available.");
    }

    // Resolve included dish names from the package's eligible items so the
    // snapshot remains readable after catalog changes.
    const eligibleByName = new Map<string, string>();
    for (const e of pkg.eligibleItems) {
      eligibleByName.set(`${e.menuItemId}|${e.selectionCategory}`, e.menuItemName);
    }

    const included: IncludedSelectionSnapshot[] = g.included.map((s) => {
      const name = eligibleByName.get(`${s.menuItemId}|${s.selectionCategory}`);
      if (!name) {
        throw new Error("An included selection is no longer eligible for this package.");
      }
      return {
        menuItemId: s.menuItemId,
        name,
        category: s.selectionCategory,
      };
    });

    const addons: GuestAddonSnapshot[] = g.addons.map((a) => {
      const addon = addonById.get(a.addonId);
      if (!addon || !addon.isActive) {
        throw new Error("A selected add-on is no longer available.");
      }
      return {
        addonId: a.addonId,
        name: addon.name,
        price: addon.priceCents,
        quantity: a.quantity,
      };
    });

    return {
      guestIndex: g.guestIndex,
      category: g.category,
      name: g.name ?? "",
      packageId: g.packageId,
      packageName: pkg.name,
      packagePrice: pkg.pricePerPersonCents,
      included,
      addons,
    };
  });

  const platterSnapshots: ReservationPlatterSnapshot[] = platters.map((p) => {
    const platter = platterById.get(p.platterId);
    if (!platter || !platter.isActive) {
      throw new Error("A selected shared platter is no longer available.");
    }
    return {
      platterId: p.platterId,
      name: platter.name,
      price: platter.pricePerPlatterCents,
      quantity: p.quantity,
    };
  });

  return { guests: guestSnapshots, platters: platterSnapshots };
}
