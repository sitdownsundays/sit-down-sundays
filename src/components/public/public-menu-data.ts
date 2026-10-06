/**
 * Public menu page — query options + view (client-safe).
 *
 * Reads published CMS menus through the existing authenticated server
 * functions (listPublishedMenus / getPublishedMenuBySlug), which use the
 * anonymous/RLS-backed repository path. Drafts, archived menus, menus outside
 * their publication window, inactive items, and items in inactive sections are
 * never returned by the server, so this layer never needs to re-filter them.
 *
 * Framework-independent presentation logic lives here; no server-only imports.
 */
/**
 * Featured menu items for the homepage preview (client-safe).
 *
 * Selects up to FEATURED_LIMIT items marked isFeatured from currently visible
 * published menus. Because listPublishedMenus already applies the public
 * filter (active items only, same-menu active sections, publication window),
 * the featured selection only re-orders and limits — it never re-filters
 * visibility. Ordering is deterministic: menu displayOrder, then item
 * displayOrder, with a stable ID tie-breaker.
 */
import { queryOptions } from "@tanstack/react-query";
import { listPublishedMenus, getPublishedMenuBySlug } from "@/lib/menu.functions";
import type { MenuWithContentDTO, MenuItemDTO } from "@/lib/menu/types";

/** Query options for the published-menu list (SSR-primed via the route loader). */
export const publishedMenusQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "menus"],
    queryFn: async () => {
      const res = await listPublishedMenus();
      if (!res.ok) throw new Error(res.message);
      return res.menus;
    },
    // Do not cache publication visibility indefinitely — CMS edits should be
    // reflected when the user navigates back to /menu.
    staleTime: 0,
  });

/** Query options for a single published menu by slug. */
export const publishedMenuBySlugQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["public", "menus", slug],
    queryFn: async () => {
      const res = await getPublishedMenuBySlug({ data: { slug } });
      if (!res.ok) throw new Error(res.message);
      return res.menu;
    },
    staleTime: 0,
  });

/**
 * Group a menu's eligible items into ordered sections, plus an
 * "Additional dishes" bucket for unassigned items. Empty sections are omitted.
 * Items are already filtered to active + same-menu active-section by the
 * server (RLS / buildMenuDTO publicOnly), so this is pure presentation.
 */
export interface MenuSectionView {
  id: string | "__unassigned";
  name: string;
  description: string;
  items: MenuItemDTO[];
}

export function groupMenuSections(menu: MenuWithContentDTO): MenuSectionView[] {
  const sections: MenuSectionView[] = menu.sections
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      items: [],
    }));

  const byId = new Map(sections.map((s) => [s.id, s]));
  const unassigned: MenuItemDTO[] = [];

  for (const item of menu.items.slice().sort((a, b) => a.displayOrder - b.displayOrder)) {
    if (item.sectionId && byId.has(item.sectionId)) {
      byId.get(item.sectionId)!.items.push(item);
    } else {
      unassigned.push(item);
    }
  }

  const visible = sections.filter((s) => s.items.length > 0);
  if (unassigned.length > 0) {
    visible.push({
      id: "__unassigned",
      name: "Additional dishes",
      description: "",
      items: unassigned,
    });
  }
  return visible;
}

/* ----------------------------- Featured items (homepage) ----------------------------- */

/** Maximum number of featured items shown on the homepage preview. */
export const FEATURED_LIMIT = 6;

/**
 * Select up to FEATURED_LIMIT featured items from currently visible published
 * menus. Visibility (active item, active same-menu section, publication
 * window) is already enforced by the server's public read path, so this only
 * filters by isFeatured, orders deterministically, and limits.
 *
 * Ordering: menu displayOrder → item displayOrder → item id (stable tie-break).
 */
export function selectFeaturedItems(menus: MenuWithContentDTO[]): MenuItemDTO[] {
  return menus
    .flatMap((menu) => menu.items.filter((item) => item.isFeatured).map((item) => ({ item, menu })))
    .sort((a, b) => {
      if (a.menu.displayOrder !== b.menu.displayOrder) {
        return a.menu.displayOrder - b.menu.displayOrder;
      }
      if (a.item.displayOrder !== b.item.displayOrder) {
        return a.item.displayOrder - b.item.displayOrder;
      }
      // Stable tie-breaker so ordering is deterministic across renders.
      return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
    })
    .slice(0, FEATURED_LIMIT)
    .map(({ item }) => item);
}

/** Query options for the homepage featured-items preview (SSR-primed). */
export const featuredMenuItemsQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "menus", "featured"],
    queryFn: async () => {
      const res = await listPublishedMenus();
      if (!res.ok) throw new Error(res.message);
      return selectFeaturedItems(res.menus);
    },
    // Do not cache publication visibility indefinitely — CMS edits should be
    // reflected when the user navigates back to the homepage.
    staleTime: 0,
  });
