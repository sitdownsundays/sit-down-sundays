/**
 * Admin reservation detail — party feast summary / guest-level breakdown.
 *
 * When all guests share the same package and identical included selections,
 * display ONE "Party feast" summary using saved snapshot dish names.
 *
 * When guests have mixed packages, different selections, or individual
 * add-ons, fall back to a clearly labeled guest-level breakdown so
 * exceptions are visible — never hidden or silently described as shared.
 *
 * Uses SAVED reservation snapshots, never live menu configuration.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";
import { CurrencyDisplay } from "@/components/layout/currency-display";
import {
  isSharedFeast,
  hasIndividualAddons,
  extractSharedFeast,
  groupSelectionsByCategory,
} from "@/components/admin/party-feast-summary-helpers";

type Guest = ReservationDetailDTO["guests"][number];

/**
 * Read-only meal summary. Picks the right presentation based on whether
 * the party shares one uniform feast or has exceptions.
 */
export function PartyFeastSummary({ guests }: { guests: Guest[] }) {
  if (guests.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg font-semibold text-foreground">Meal summary</h3>
        <p className="mt-2 text-sm text-muted-foreground">No guest allocations saved.</p>
      </div>
    );
  }

  const shared = isSharedFeast(guests);
  const hasAddons = hasIndividualAddons(guests);

  // Uniform party with no individual add-ons → single shared feast summary.
  if (shared && !hasAddons) {
    const feast = extractSharedFeast(guests);
    if (feast) return <SharedFeastCard guests={guests} feast={feast} />;
  }

  // Mixed packages, different selections, or individual add-ons →
  // guest-level breakdown so exceptions remain visible.
  return <GuestBreakdown guests={guests} shared={shared} />;
}

/* --------------------------- Shared feast card --------------------------- */

function SharedFeastCard({
  guests,
  feast,
}: {
  guests: Guest[];
  feast: NonNullable<ReturnType<typeof extractSharedFeast>>;
}) {
  const { packageName, packagePriceCents, selections, hasSoftDrink } = feast;
  const partySize = guests.length;

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-lg font-semibold text-foreground">Party feast</h3>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {packageName}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Party size
          </dt>
          <dd className="mt-1 text-sm font-medium text-foreground">
            {partySize} {partySize === 1 ? "guest" : "guests"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Per-person price
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            <CurrencyDisplay cents={packagePriceCents} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Subtotal
          </dt>
          <dd className="mt-1 text-sm font-medium text-foreground">
            <CurrencyDisplay cents={packagePriceCents * partySize} />
          </dd>
        </div>
      </dl>

      {/* Selected dishes — using saved snapshot names */}
      <div className="mt-5 space-y-3">
        {selections.meat.length > 0 && (
          <SelectionRow label="Selected meats" items={selections.meat.map((s) => s.name)} />
        )}
        {selections.side.length > 0 && (
          <SelectionRow label="Selected sides" items={selections.side.map((s) => s.name)} />
        )}
        {selections.bread.length > 0 && (
          <SelectionRow label="Bread choice" items={selections.bread.map((s) => s.name)} />
        )}
        {hasSoftDrink && (
          <SelectionRow label="Included drink" items={selections.drink.map((s) => s.name)} />
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Served family-style. Pricing is per person; adult/senior/child differences are reflected in
        the totals below.
      </p>
    </div>
  );
}

/* --------------------------- Guest breakdown --------------------------- */

function GuestBreakdown({ guests, shared }: { guests: Guest[]; shared: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="font-display text-lg font-semibold text-foreground">Meal allocations</h3>
      {!shared && (
        <p className="mt-1 text-xs text-muted-foreground">
          Guests ordered different packages or selections. Each guest's meal is shown below.
        </p>
      )}
      {shared && hasIndividualAddons(guests) && (
        <p className="mt-1 text-xs text-muted-foreground">
          Guests share the same package and dishes. Individual add-ons are listed per guest.
        </p>
      )}
      <div className="mt-4 space-y-4">
        {guests.map((g) => {
          const groups = groupSelectionsByCategory(g.includedSelections);
          return (
            <div key={g.id} className="rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">
                  {g.guestName ?? `Guest ${g.guestIndex + 1}`}
                  <span className="ml-2 text-xs font-normal uppercase tracking-wider text-muted-foreground">
                    {g.guestCategory}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {g.packageNameSnapshot} · <CurrencyDisplay cents={g.packagePriceSnapshot} />
                </p>
              </div>

              {g.includedSelections.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Included selections
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {g.includedSelections.map((s, i) => (
                      <li
                        key={`${s.menuItemId}-${i}`}
                        className="rounded-full bg-accent px-2.5 py-0.5 text-xs text-accent-foreground"
                      >
                        <span className="capitalize">{s.selectionCategory}</span>
                        {s.name ? `: ${s.name}` : `: ${s.menuItemId}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {g.addons.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Individual add-ons
                  </p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {g.addons.map((a) => (
                      <li key={a.id} className="flex justify-between">
                        <span>
                          {a.addonNameSnapshot} × {a.quantity}
                        </span>
                        <CurrencyDisplay cents={a.pricePerUnitSnapshot * a.quantity} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------- Selection row --------------------------- */

function SelectionRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{items.join(", ")}</p>
    </div>
  );
}
