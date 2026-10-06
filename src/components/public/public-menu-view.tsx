/**
 * Public menu view — renders published CMS menus with a selector, sections,
 * and items using the existing branded MenuItemCard.
 *
 * Presentation only. No server-only imports. All visibility filtering happens
 * server-side (RLS / publication rules); this layer groups and orders.
 */
import { useState, useMemo, useEffect } from "react";
import { useSuspenseQuery, useQuery, type QueryObserverOptions } from "@tanstack/react-query";
import { MenuItemCard } from "@/components/layout/menu-item-card";
import { ButtonLink } from "@/components/layout/button-link";
import { ErrorState } from "@/components/layout/error-state";
import { EmptyState } from "@/components/layout/empty-state";
import { groupMenuSections } from "./public-menu-data";
import type { MenuWithContentDTO } from "@/lib/menu/types";
import type { MenuItem } from "@/lib/domain/types";

interface PublicMenuViewProps {
  listOptions: QueryObserverOptions<MenuWithContentDTO[], Error>;
  bySlugOptions: (slug: string) => QueryObserverOptions<MenuWithContentDTO | null, Error>;
}

/** Map a CMS MenuItemDTO to the domain MenuItem shape the card expects. */
function dtoToCardItem(dto: MenuWithContentDTO["items"][number]): MenuItem {
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

export function PublicMenuView({ listOptions, bySlugOptions }: PublicMenuViewProps) {
  const { data: menus, error: listError, refetch: refetchList } = useSuspenseQuery(listOptions);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    menus.length > 0 ? menus[0].slug : null,
  );

  // Reconcile selection when the list refreshes after a CMS edit. If the
  // selected menu was archived/expired/unpublished it drops out of the
  // published list; fall back to the first available menu so the page never
  // shows a stale "No dishes available yet" state for a menu that no longer
  // exists, and the selector always reflects a real, available menu.
  useEffect(() => {
    if (menus.length === 0) {
      if (selectedSlug !== null) setSelectedSlug(null);
      return;
    }
    const stillAvailable = menus.some((m) => m.slug === selectedSlug);
    if (!stillAvailable) setSelectedSlug(menus[0].slug);
  }, [menus, selectedSlug]);

  const singleQuery = useQuery({
    ...bySlugOptions(selectedSlug ?? ""),
    enabled: selectedSlug != null,
  });

  const activeMenu = useMemo<MenuWithContentDTO | null>(() => {
    // Prefer the authoritative single-menu fetch when available; fall back to
    // the list entry so the UI never blocks on the secondary query.
    if (selectedSlug == null) return null;
    if (singleQuery.data !== undefined) return singleQuery.data;
    return menus.find((m) => m.slug === selectedSlug) ?? null;
  }, [selectedSlug, singleQuery.data, menus]);

  if (listError) {
    return (
      <div className="mt-10">
        <ErrorState
          title="Menu could not be loaded"
          message="Something went wrong while loading the menu. Please try again."
          action={
            <button
              type="button"
              onClick={() => refetchList()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  if (menus.length === 0) {
    return (
      <div className="mt-10">
        <EmptyState
          title="The menu is being finalized"
          description="Our menu is still being prepared. Please check back soon, or join the waitlist to be the first to know."
          action={<ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>}
        />
      </div>
    );
  }

  const sections = activeMenu ? groupMenuSections(activeMenu) : [];

  return (
    <div className="mt-10 space-y-10">
      {menus.length > 1 && (
        <nav aria-label="Select menu" className="flex flex-wrap gap-2">
          {menus.map((m) => {
            const selected = m.slug === selectedSlug;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedSlug(m.slug)}
                aria-pressed={selected}
                className={
                  selected
                    ? "rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors"
                    : "rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                }
              >
                {m.name}
              </button>
            );
          })}
        </nav>
      )}

      {activeMenu && activeMenu.description && (
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          {activeMenu.description}
        </p>
      )}

      {activeMenu && sections.length === 0 && (
        <EmptyState
          title="No dishes available yet"
          description="This menu is still being finalized. Please check back soon."
        />
      )}

      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`section-${section.id}-title`}>
          <h2
            id={`section-${section.id}-title`}
            className="font-display text-2xl font-bold text-foreground"
          >
            {section.name}
          </h2>
          {section.description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {section.description}
            </p>
          )}
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <MenuItemCard key={item.id} item={dtoToCardItem(item)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
