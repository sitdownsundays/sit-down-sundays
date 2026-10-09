/**
 * Admin reservation detail — guest dietary note display helpers.
 *
 * Pure, framework-independent helpers shared between the read-only
 * GuestDietaryNeeds component and its focused tests. No React imports so
 * they can live outside the component module (avoids react-refresh
 * only-export-components warnings on the component file).
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";

/** Human-readable category label for a guest category. */
const CATEGORY_LABELS: Record<string, string> = {
  adult: "Adult",
  senior: "Senior",
  child: "Child",
};

/** Human-readable category label, falling back to the raw value. */
export function guestCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Does this guest have any non-empty dietary note? */
export function guestHasDietaryNotes(
  g: Pick<
    ReservationDetailDTO["guests"][number],
    "foodAllergies" | "dietaryPreferences" | "mealRequests"
  >,
): boolean {
  return (
    (g.foodAllergies ?? "").trim() !== "" ||
    (g.dietaryPreferences ?? "").trim() !== "" ||
    (g.mealRequests ?? "").trim() !== ""
  );
}

/**
 * Human-readable display label for a guest: their entered name, or
 * "Guest N" (1-based guest index) when unnamed.
 */
export function guestDisplayLabel(
  guestName: string | null | undefined,
  guestIndex: number,
): string {
  const name = guestName?.trim();
  return name && name.length > 0 ? name : `Guest ${guestIndex + 1}`;
}
