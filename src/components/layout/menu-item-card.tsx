import { cn } from "@/lib/utils";
import type { MenuCategory, MenuItem } from "@/lib/domain/types";
import { CurrencyDisplay } from "./currency-display";

/**
 * Human-readable course labels for each menu category.
 * Kept here (presentation) rather than in the domain model.
 */
const CATEGORY_LABELS: Record<MenuCategory, string> = {
  starter: "Starter",
  main: "Main",
  side: "Side",
  dessert: "Dessert",
  beverage: "Beverage",
  children: "Children",
};

interface MenuItemCardProps {
  item: MenuItem;
  className?: string;
}

/**
 * Menu-item preview card.
 *
 * Structure: photograph → course label → name + price → description → tags.
 * The image is meaningful (it depicts a specific dish), so it carries real
 * alt text. When `imageUrl` is absent a graceful neutral fallback renders so
 * the item name and price never disappear. Hover elevation / image scale are
 * restrained and disabled under prefers-reduced-motion (global CSS rule).
 */
export function MenuItemCard({ item, className }: MenuItemCardProps) {
  return (
    <article
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg motion-reduce:translate-none motion-reduce:transition-none",
        className,
      )}
    >
      {/* Photograph */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.imageAlt ?? item.name}
            loading="lazy"
            decoding="async"
            className="size-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transform-none motion-reduce:transition-none"
          />
        ) : (
          <div
            className="flex size-full items-center justify-center bg-gradient-to-br from-clay/15 via-sage/10 to-gold/15"
            aria-hidden
          >
            <span className="font-display text-sm text-muted-foreground">Photo coming soon</span>
          </div>
        )}
        {/* Subtle warm overlay for depth */}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-charcoal/15 to-transparent"
          aria-hidden
        />
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-5">
        <span className="text-xs font-medium uppercase tracking-wide text-sage">
          {CATEGORY_LABELS[item.category]}
        </span>
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <h3 className="font-display text-lg font-semibold leading-snug text-foreground">
            {item.name}
          </h3>
          <CurrencyDisplay
            cents={item.priceCents}
            className="shrink-0 font-display text-lg font-semibold text-clay"
          />
        </div>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
          {item.description}
        </p>

        {/* Dietary + allergen tags — never communicated by color alone */}
        {(item.dietaryTags.length > 0 || item.allergens.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {item.dietaryTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-sage/30 bg-sage/15 px-2.5 py-0.5 text-xs font-medium text-sage"
              >
                {tag}
              </span>
            ))}
            {item.allergens.map((a) => (
              <span
                key={a}
                className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {a}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
