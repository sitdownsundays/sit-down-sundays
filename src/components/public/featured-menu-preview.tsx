/**
 * Homepage featured-menu preview — CMS-powered (client-safe).
 *
 * Renders up to six isFeatured items from currently visible published menus,
 * using the existing branded MenuItemCard. Uses the established loader/query
 * pattern (useSuspenseQuery) so SSR primes the cache and hydration matches.
 *
 * Empty state: when no featured items exist, a tasteful "coming soon" message.
 * Error state: a distinct error/retry region (never the empty state).
 *
 * In Supabase mode, listPublishedMenus never substitutes mock dishes when data
 * is empty or unavailable — so an empty result here means no featured content.
 *
 * Presentation only. No server-only imports.
 */
import { useSuspenseQuery, type QueryObserverOptions } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { MenuItemCard } from "@/components/layout/menu-item-card";
import { ButtonLink } from "@/components/layout/button-link";
import { ErrorState } from "@/components/layout/error-state";
import type { MenuItem } from "@/lib/domain/types";
import type { MenuItemDTO } from "@/lib/menu/types";

interface FeaturedMenuPreviewProps {
  options: QueryObserverOptions<MenuItemDTO[], Error>;
}

/** Map a CMS MenuItemDTO to the domain MenuItem shape the card expects. */
function dtoToCardItem(dto: MenuItemDTO): MenuItem {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    category: dto.category,
    priceCents: dto.priceCents,
    allergens: dto.allergens,
    dietaryTags: dto.dietaryTags,
    available: dto.isActive,
    imageUrl: dto.imageUrl ?? undefined,
    imageAlt: dto.imageAlt ?? undefined,
  };
}

export function FeaturedMenuPreview({ options }: FeaturedMenuPreviewProps) {
  const { data: featured, error, refetch } = useSuspenseQuery(options);

  if (error) {
    return (
      <ErrorState
        title="Featured dishes could not be loaded"
        message="Something went wrong while loading the menu preview. Please try again."
        action={
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
        }
      />
    );
  }

  if (featured.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
        <h3 className="font-display text-xl font-semibold text-foreground">
          Our Sunday menu is coming soon
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          We're still finalizing the dishes. Join the waitlist to be the first to know when the menu
          is ready.
        </p>
        <div className="mt-5">
          <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-12 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
        {featured.map((item) => (
          <MenuItemCard key={item.id} item={dtoToCardItem(item)} className="h-full" />
        ))}
      </div>
      <div className="mt-12 flex flex-col items-center gap-3 text-center">
        <ButtonLink to="/menu" size="lg">
          Explore the Full Menu <ArrowRight className="size-4" />
        </ButtonLink>
        <p className="text-sm text-muted-foreground">
          Provisional menu — final details coming soon.
        </p>
      </div>
    </>
  );
}
