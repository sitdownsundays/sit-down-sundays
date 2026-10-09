/**
 * Booking wizard Step 4 (Review & submit) helpers — client-safe.
 *
 * Assembles the wizard state into the typed submission payload, resolves
 * catalog names for display, and gates submission on an authoritative quote.
 *
 * No server-only imports, no env access, no Supabase. The server revalidates
 * authoritatively at submission; no browser-calculated prices are trusted.
 */
import type { QuoteResult } from "@/lib/public-quote.functions";
import type { PublicOrderingCatalog } from "@/lib/booking/public-catalog";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";
import type { SubmitReservationRequestInput } from "@/lib/reservation/types";

/** Format integer cents as a dollar string (e.g. 2950 -> "$29.50"). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars}.${String(remainder).padStart(2, "0")}`;
}

/**
 * Build the typed submission payload from wizard state.
 *
 * Omits optional contact fields when empty (so the server sees "not supplied"
 * rather than an empty string). Never includes browser-calculated prices,
 * totals, discounts, status, or actor identity — the server recalculates all
 * of those authoritatively.
 */
export function buildSubmissionPayload(
  state: BookWizardState,
  idempotencyKey: string,
  clientPreviewSubtotalCents?: number,
): SubmitReservationRequestInput {
  const partySize = state.adults + state.seniors + state.children;
  const payload: SubmitReservationRequestInput = {
    sundayServiceId: state.sundayServiceId!,
    seatingTimeId: state.seatingTimeId!,
    experienceType: "standard",
    partySize,
    adults: state.adults,
    seniors: state.seniors,
    children: state.children,
    contactFirstName: state.contact.contactFirstName.trim(),
    contactLastName: state.contact.contactLastName.trim(),
    contactEmail: state.contact.contactEmail.trim(),
    contactPhone: state.contact.contactPhone.trim(),
    guests: state.meals.allocations.map((a) => ({
      guestIndex: a.guestIndex,
      category: a.category,
      name: a.name.trim() || undefined,
      packageId: a.packageId!,
      included: a.included,
      addons: a.addons,
      // Per-guest notes: include only when non-empty (omit otherwise for
      // backward compatibility with older callers). The server defaults
      // missing values to empty strings. Guard against undefined for older
      // allocations created before note fields existed.
      ...((a.foodAllergies ?? "").trim() ? { foodAllergies: (a.foodAllergies ?? "").trim() } : {}),
      ...((a.dietaryPreferences ?? "").trim()
        ? { dietaryPreferences: (a.dietaryPreferences ?? "").trim() }
        : {}),
      ...((a.mealRequests ?? "").trim() ? { mealRequests: (a.mealRequests ?? "").trim() } : {}),
    })),
    platters: state.meals.platters,
    idempotencyKey,
  };

  // Optional contact fields: omit when empty (not supplied), include when set.
  if (state.contact.dietaryNotes.trim()) payload.dietaryNotes = state.contact.dietaryNotes.trim();
  if (state.contact.accessibilityRequests.trim())
    payload.accessibilityRequests = state.contact.accessibilityRequests.trim();
  if (state.contact.occasion.trim()) payload.occasion = state.contact.occasion.trim();
  if (state.contact.guestNotes.trim()) payload.guestNotes = state.contact.guestNotes.trim();

  if (clientPreviewSubtotalCents !== undefined) {
    payload.clientPreviewSubtotalCents = clientPreviewSubtotalCents;
  }
  return payload;
}

/**
 * Whether the current quote is submittable. Blocks submission while loading,
 * missing, failed, or when pricing rules are unresolved. An unresolved quote
 * is never treated as a completed price.
 */
export function quoteIsSubmittable(quote: QuoteResult | null, loading: boolean): boolean {
  if (loading) return false;
  if (!quote) return false;
  if (!quote.ok) return false;
  if (quote.hasUnresolvedRules) return false;
  return true;
}

/** Resolve a menu item's display name from the catalog's eligible items. */
export function menuItemName(catalog: PublicOrderingCatalog | null, menuItemId: string): string {
  if (!catalog) return menuItemId;
  for (const pkg of catalog.packages) {
    const found = pkg.eligibleItems.find((i) => i.menuItemId === menuItemId);
    if (found) return found.menuItemName;
  }
  return menuItemId;
}

/** Resolve an add-on's display name. */
export function addonName(catalog: PublicOrderingCatalog | null, addonId: string): string {
  if (!catalog) return addonId;
  return catalog.addons.find((a) => a.id === addonId)?.name ?? addonId;
}

/** Resolve a package's display name. */
export function packageName(catalog: PublicOrderingCatalog | null, packageId: string): string {
  if (!packageId) return "No package";
  if (!catalog) return packageId;
  return catalog.packages.find((p) => p.id === packageId)?.name ?? packageId;
}

/** Resolve a shared platter's display name. */
export function platterName(catalog: PublicOrderingCatalog | null, platterId: string): string {
  if (!catalog) return platterId;
  return catalog.platters.find((p) => p.id === platterId)?.name ?? platterId;
}

/**
 * Generate a cryptographically random idempotency key for a logical request.
 * Uses the Web Crypto API. The key is stable across retries of the SAME
 * logical request — the caller generates it once and reuses it until the
 * request succeeds or the user starts a materially different request.
 *
 * Fails safely (returns null) if secure generation is unavailable rather than
 * falling back to Math.random, which is not cryptographically secure.
 */
export function generateIdempotencyKey(): string | null {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) return null;
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `bk_${hex}`;
}
