/**
 * SERVER-ONLY — normalize the validated submission schema output into the
 * authoritative SubmitReservationRequestInput without unchecked casts.
 *
 * `submitReservationRequestSchema.parse()` returns a type whose optional
 * fields may be explicitly `undefined` (e.g. `clientPreviewSubtotalCents`,
 * `guestNotes`, guest `name`, per-guest notes). `SubmitReservationRequestInput`
 * uses exact optional properties (`field?: T`), so passing the parsed object
 * directly triggers TS2379 ("conditional types are not assignable"). This
 * module maps the parsed shape into the authoritative input, omitting each
 * optional property ONLY when its value is `undefined`, while preserving
 * supplied empty strings, zero subtotals, notes, categories, selections,
 * add-ons, platters, contact details, and the idempotency key.
 *
 * Decisions use identity checks against `undefined` — never truthiness — so a
 * legitimately supplied empty string ("") or zero (0) is retained exactly.
 * Does not mutate the input.
 */
import type { GuestCategory, SelectionCategory } from "@/lib/ordering/constants";
import type {
  SubmitReservationRequestInput,
  ReservationGuestInput,
  ReservationPlatterInput,
  ReservationExperienceType,
  ReviewedPrice,
} from "@/lib/reservation/types";

/**
 * Structural guest shape — compatible with z.infer<typeof guestInputSchema>.
 *
 * NOTE: optional `name`/notes use `T | undefined` (not plain `T?`) because
 * this is an INPUT contract representing parsed schema output: Zod's
 * `.optional()` infers `T | undefined`, which includes an *explicit*
 * `undefined` value. Under `exactOptionalPropertyTypes`, a plain `name?: string`
 * would reject `name: undefined`. The OUTPUT type
 * (`ReservationGuestInput.name`/notes) stays strict — the normalizer omits
 * each key when its value is `undefined`.
 */
export interface SubmitGuestInput {
  guestIndex: number;
  category: GuestCategory;
  name?: string | undefined;
  packageId: string;
  included: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>;
  addons: Array<{ addonId: string; quantity: number }>;
  foodAllergies?: string | undefined;
  dietaryPreferences?: string | undefined;
  mealRequests?: string | undefined;
}

/**
 * Structural submission shape — compatible with the parsed schema output.
 *
 * Optional party-level fields and the preview subtotal use `T | undefined`
 * for the same INPUT-contract reason as `SubmitGuestInput` above. The OUTPUT
 * type (`SubmitReservationRequestInput`) stays strict.
 */
export interface SubmitRequestInput {
  sundayServiceId: string;
  seatingTimeId: string;
  experienceType: ReservationExperienceType;
  partySize: number;
  adults: number;
  seniors: number;
  children: number;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  guestNotes?: string | undefined;
  dietaryNotes?: string | undefined;
  accessibilityRequests?: string | undefined;
  occasion?: string | undefined;
  guests: SubmitGuestInput[];
  platters: ReservationPlatterInput[];
  idempotencyKey: string;
  clientPreviewSubtotalCents?: number | undefined;
  /**
   * Full reviewed-price snapshot (see ReviewedPrice). Optional for legacy
   * callers that omit it; the server's NEW-request guard requires it for a
   * fresh request. The normalizer preserves it exactly when supplied.
   */
  clientPreviewPrice?: ReviewedPrice | undefined;
}

function normalizeGuest(g: SubmitGuestInput): ReservationGuestInput {
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
  // Omit optional name/notes ONLY when undefined — preserve supplied empty
  // strings. Identity check, never truthiness.
  if (g.name !== undefined) base.name = g.name;
  if (g.foodAllergies !== undefined) base.foodAllergies = g.foodAllergies;
  if (g.dietaryPreferences !== undefined) base.dietaryPreferences = g.dietaryPreferences;
  if (g.mealRequests !== undefined) base.mealRequests = g.mealRequests;
  return base;
}

/**
 * Normalize the validated submission into SubmitReservationRequestInput.
 *
 * - Omits optional contact/party notes and the preview subtotal ONLY when
 *   undefined — preserves supplied empty strings and a zero subtotal.
 * - Omits per-guest name/notes ONLY when undefined — preserves empty strings.
 * - Preserves the idempotency key, contact details, categories, selections,
 *   add-ons, and platters exactly.
 * - Does not mutate the input.
 */
export function normalizeSubmitRequest(data: SubmitRequestInput): SubmitReservationRequestInput {
  const input: SubmitReservationRequestInput = {
    sundayServiceId: data.sundayServiceId,
    seatingTimeId: data.seatingTimeId,
    experienceType: data.experienceType,
    partySize: data.partySize,
    adults: data.adults,
    seniors: data.seniors,
    children: data.children,
    contactFirstName: data.contactFirstName,
    contactLastName: data.contactLastName,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    guests: data.guests.map(normalizeGuest),
    platters: data.platters.map((p) => ({
      platterId: p.platterId,
      quantity: p.quantity,
    })),
    idempotencyKey: data.idempotencyKey,
  };
  // Omit optional party-level fields ONLY when undefined. A supplied empty
  // string ("") is a valid value and must be retained — use identity, not
  // truthiness. Zero is a valid preview subtotal and must be retained.
  if (data.guestNotes !== undefined) input.guestNotes = data.guestNotes;
  if (data.dietaryNotes !== undefined) input.dietaryNotes = data.dietaryNotes;
  if (data.accessibilityRequests !== undefined)
    input.accessibilityRequests = data.accessibilityRequests;
  if (data.occasion !== undefined) input.occasion = data.occasion;
  if (data.clientPreviewSubtotalCents !== undefined)
    input.clientPreviewSubtotalCents = data.clientPreviewSubtotalCents;
  if (data.clientPreviewPrice !== undefined) input.clientPreviewPrice = data.clientPreviewPrice;
  return input;
}
