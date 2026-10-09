/**
 * Booking wizard Step 2 — shared platters / pitchers section.
 *
 * Party-level shared extras priced PER PLATTER (never multiplied by guest
 * count). Quantities are explicit. Client-safe.
 */
import { Button } from "@/components/ui/button";
import { setPlatterQuantity } from "@/lib/booking/meals-helpers";
import type { PublicOrderingCatalog } from "@/lib/booking/public-catalog";

interface Props {
  catalog: PublicOrderingCatalog;
  platters: Array<{ platterId: string; quantity: number }>;
  onPlatterQty: (platters: Array<{ platterId: string; quantity: number }>) => void;
}

export function SharedPlattersSection({ catalog, platters, onPlatterQty }: Props) {
  if (catalog.platters.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="font-display text-base font-semibold text-foreground">
        For the table — shared platters &amp; pitchers
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        These are priced per platter or pitcher, not per guest. Add as many as you'd like for your
        party.
      </p>

      <div className="mt-4 space-y-2">
        {catalog.platters.map((p) => {
          const line = platters.find((x) => x.platterId === p.id);
          const qty = line?.quantity ?? 0;
          return (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-3"
            >
              <div className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{p.name}</span>
                {p.description && (
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                )}
                {p.servingGuidance && (
                  <span className="block text-xs text-muted-foreground">{p.servingGuidance}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Fewer ${p.name}`}
                  onClick={() => onPlatterQty(setPlatterQuantity(platters, p.id, qty - 1))}
                  disabled={qty <= 0}
                >
                  −
                </Button>
                <span className="w-6 text-center text-sm" aria-live="polite">
                  {qty}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`More ${p.name}`}
                  onClick={() => onPlatterQty(setPlatterQuantity(platters, p.id, qty + 1))}
                >
                  +
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
