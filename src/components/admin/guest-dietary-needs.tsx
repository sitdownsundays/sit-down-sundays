/**
 * Admin reservation detail — read-only per-guest dietary needs display.
 *
 * One party shares one family-style feast. These are personal needs within
 * that single order — NOT separate orders or seat assignments. Display-only:
 *  - No edit controls.
 *  - No acknowledgment/approval status.
 *  - No "safe" or diagnosis claims.
 *
 * Food allergies are visually prominent via a text label (not color alone).
 * Notes render as plain text (whitespace-pre-wrap), never as HTML.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";
import {
  guestCategoryLabel,
  guestHasDietaryNotes,
  guestDisplayLabel,
} from "@/components/admin/guest-dietary-needs-helpers";

/**
 * Read-only per-guest dietary needs display. Renders one card per guest who
 * has any non-empty note. Guests with no notes are excluded; if none have
 * notes, shows a single "No guest dietary notes provided." message.
 */
export function GuestDietaryNeeds({ guests }: { guests: ReservationDetailDTO["guests"] }) {
  const withNotes = guests.filter(guestHasDietaryNotes);

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="font-display text-lg font-semibold text-foreground">Guest dietary needs</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Personal needs within one party order. Requests require staff review and are not
        confirmations of accommodation.
      </p>

      {withNotes.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No guest dietary notes provided.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {withNotes.map((g) => {
            const label = guestDisplayLabel(g.guestName, g.guestIndex);
            return (
              <div key={g.id} className="rounded-md border border-border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{label}</p>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                    {guestCategoryLabel(g.guestCategory)}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {(g.foodAllergies ?? "").trim() !== "" && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
                        Food allergies
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                        {g.foodAllergies}
                      </p>
                    </div>
                  )}
                  {(g.dietaryPreferences ?? "").trim() !== "" && (
                    <div className="rounded-md bg-accent/30 p-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Dietary preferences / restrictions
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                        {g.dietaryPreferences}
                      </p>
                    </div>
                  )}
                  {(g.mealRequests ?? "").trim() !== "" && (
                    <div className="rounded-md bg-accent/30 p-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Meal-specific requests
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                        {g.mealRequests}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
