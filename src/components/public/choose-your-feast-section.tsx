import { useSuspenseQuery } from "@tanstack/react-query";
import { publishedFeastOfferingsQueryOptions } from "./feast-offerings-data";
import { CurrencyDisplay } from "@/components/layout/currency-display";
import { Check } from "lucide-react";
import type { FeastOfferingDTO } from "@/lib/feast/types";

export function ChooseYourFeastSection() {
  const { data: offerings } = useSuspenseQuery(publishedFeastOfferingsQueryOptions());

  if (!offerings || offerings.length === 0) {
    return null;
  }

  // Ensure deterministic sort: displayOrder asc, then name asc
  const sorted = [...offerings].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );

  return (
    <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      {sorted.map((offering) => (
        <FeastCard key={offering.id} offering={offering} />
      ))}
    </div>
  );
}

function FeastCard({ offering }: { offering: FeastOfferingDTO }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-md">
      {/* Cover Image */}
      <div className="relative aspect-4/3 w-full overflow-hidden bg-muted">
        {offering.coverImageUrl ? (
          <img
            src={offering.coverImageUrl}
            alt={offering.coverImageAlt || offering.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/60 text-sm text-muted-foreground">
            Sit Down Sundays
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4">
          <span className="inline-block rounded-full bg-primary/90 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary-foreground backdrop-blur-xs">
            Curated Feast
          </span>
        </div>
      </div>

      {/* Card Content */}
      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {offering.name}
          </h3>
          {offering.pricePerPersonCents !== null && (
            <div className="text-right">
              <span className="font-display text-2xl font-bold text-primary">
                <CurrencyDisplay cents={offering.pricePerPersonCents} />
              </span>
              <span className="block text-xs font-medium text-muted-foreground">/ person</span>
            </div>
          )}
        </div>

        {offering.description && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {offering.description}
          </p>
        )}

        {offering.inclusions.length > 0 && (
          <div className="mt-6 flex-1 border-t border-border/80 pt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What's Included
            </h4>
            <ul className="mt-3 space-y-2.5">
              {offering.inclusions.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2.5 text-sm text-foreground/90">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Check className="size-2.5 stroke-[3]" />
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 border-t border-border/60 pt-4 text-center">
          <p className="text-xs font-medium text-muted-foreground italic">
            Desserts and specialty beverages available separately.
          </p>
        </div>
      </div>
    </div>
  );
}
