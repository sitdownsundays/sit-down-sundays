/**
 * SERVER-ONLY — normalize the public quote endpoint's parsed guests into the
 * authoritative ReservationGuestInput[] without unchecked casts.
 *
 * The public quote schema (quoteOrderSchema) infers `category` and
 * `selectionCategory` as the exact GuestCategory / SelectionCategory literal
 * unions when the readonly constant tuples are passed directly to `z.enum`.
 * This module maps that parsed shape into ReservationGuestInput, omitting the
 * optional `name` property when undefined, while preserving every guest,
 * selection, and add-on value exactly. No notes are synthesized here (the
 * quote schema does not carry per-guest notes).
 */
import type { GuestCategory, SelectionCategory } from "@/lib/ordering/constants";
import type { ReservationGuestInput } from "@/lib/reservation/types";

/**
 * Structural input shape — compatible with z.infer<typeof quoteGuestSchema>.
 *
 * NOTE: `name` uses `string | undefined` (not plain `string?`) because this is
 * an INPUT contract representing parsed schema output: Zod's `.optional()`
 * infers `string | undefined`, which includes an *explicit* `undefined` value.
 * Under `exactOptionalPropertyTypes`, a plain `name?: string` would reject
 * `name: undefined`. The OUTPUT type (`ReservationGuestInput.name`) stays
 * strict — the normalizer omits the key when the value is `undefined`.
 */
export interface QuoteGuestInput {
  guestIndex: number;
  category: GuestCategory;
  name?: string | undefined;
  packageId: string;
  included: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>;
  addons: Array<{ addonId: string; quantity: number }>;
}

/**
 * Map parsed quote guests into authoritative ReservationGuestInput[].
 *
 * - Omits `name` when undefined (ReservationGuestInput.name is optional).
 * - Preserves supplied names, every included selection, and every add-on.
 * - Does not synthesize per-guest notes (foodAllergies/dietaryPreferences/
 *   mealRequests); the quote schema does not carry them and they remain
 *   optional on ReservationGuestInput.
 * - Does not mutate the input.
 */
export function normalizeQuoteGuests(guests: QuoteGuestInput[]): ReservationGuestInput[] {
  return guests.map((g) => {
    const base: ReservationGuestInput = {
      guestIndex: g.guestIndex,
      category: g.category,
      packageId: g.packageId,
      included: g.included.map((s) => ({
        menuItemId: s.menuItemId,
        selectionCategory: s.selectionCategory,
      })),
      addons: g.addons.map((a) => ({
        addonId: a.addonId,
        quantity: a.quantity,
      })),
    };
    if (g.name !== undefined) {
      base.name = g.name;
    }
    return base;
  });
}
