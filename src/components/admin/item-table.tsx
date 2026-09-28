/**
 * Admin Menu Items — responsive item list with reorder controls.
 *
 * Items are shown in display order. Each row offers move-up / move-down
 * controls that reorder the complete list atomically through the existing
 * reorderItems server function. Deactivation requires confirmation and is
 * handled by the parent panel. Action buttons are disabled while an action
 * is pending for that item to prevent double-submits.
 */
import { ArrowDown, ArrowUp, Pencil, Power, PowerOff, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/layout/status-badge";
import { CurrencyDisplay } from "@/components/layout/currency-display";
import type { MenuItemDTO, MenuSectionDTO } from "@/lib/menu/types";
import { formatDate } from "./menu-form-helpers";
import { sectionLabel } from "./item-form-helpers";

const CATEGORY_LABELS: Record<string, string> = {
  starter: "Starter",
  main: "Main",
  side: "Side",
  dessert: "Dessert",
  beverage: "Beverage",
  children: "Children",
};

interface ItemTableProps {
  items: MenuItemDTO[];
  sections: MenuSectionDTO[];
  onEdit: (item: MenuItemDTO) => void;
  onToggleActive: (item: MenuItemDTO) => void;
  onReorder: (orderedIds: string[]) => void;
  /** Item id currently undergoing an action; its buttons are disabled. */
  pendingId?: string | null;
  reorderPending?: boolean;
  readOnly?: boolean;
}

export function ItemTable({
  items,
  sections,
  onEdit,
  onToggleActive,
  onReorder,
  pendingId,
  reorderPending,
  readOnly,
}: ItemTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
      {/* Desktop / tablet table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Menu items</caption>
          <thead className="border-b border-border bg-muted/40 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Item
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Section
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Category
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Price
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold text-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item, idx) => {
              const busy = pendingId === item.id;
              return (
                <tr key={item.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.name}</span>
                      {item.isFeatured && (
                        <Star
                          className="size-3.5 text-amber-500"
                          aria-label="Featured"
                          aria-hidden={false}
                        />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDate(item.updatedAt)}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {sectionLabel(item, sections)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </td>
                  <td className="px-4 py-3">
                    <CurrencyDisplay cents={item.priceCents} className="font-medium" />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={item.isActive ? "success" : "neutral"}>
                      {item.isActive ? "Active" : "Inactive"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {!readOnly && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Move up"
                            onClick={() =>
                              onReorder(
                                items
                                  .map((x) => x.id)
                                  .map((id, i) => (i === idx ? items[idx - 1]?.id : id))
                                  .map((id, i) =>
                                    i === idx - 1 ? (items[idx]?.id ?? id) : (id ?? id),
                                  ),
                              )
                            }
                            disabled={reorderPending || idx === 0}
                          >
                            <ArrowUp className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Move down"
                            onClick={() =>
                              onReorder(
                                items
                                  .map((x) => x.id)
                                  .map((id, i) => (i === idx ? items[idx + 1]?.id : id))
                                  .map((id, i) =>
                                    i === idx + 1 ? (items[idx]?.id ?? id) : (id ?? id),
                                  ),
                              )
                            }
                            disabled={reorderPending || idx === items.length - 1}
                          >
                            <ArrowDown className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onEdit(item)}
                            disabled={busy || reorderPending}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onToggleActive(item)}
                            disabled={busy || reorderPending}
                          >
                            {item.isActive ? (
                              <>
                                <PowerOff className="size-3.5" aria-hidden />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <Power className="size-3.5" aria-hidden />
                                Activate
                              </>
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-border md:hidden">
        {items.map((item, idx) => {
          const busy = pendingId === item.id;
          return (
            <li key={item.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{item.name}</p>
                    {item.isFeatured && (
                      <Star className="size-3.5 text-amber-500" aria-label="Featured" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {sectionLabel(item, sections)} ·{" "}
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </p>
                </div>
                <StatusBadge tone={item.isActive ? "success" : "neutral"}>
                  {item.isActive ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt className="font-medium text-foreground/70">Price</dt>
                <dd>
                  <CurrencyDisplay cents={item.priceCents} />
                </dd>
                <dt className="font-medium text-foreground/70">Updated</dt>
                <dd>{formatDate(item.updatedAt)}</dd>
              </dl>
              {!readOnly && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onReorder(swapIds(items, idx, idx - 1))}
                    disabled={reorderPending || idx === 0}
                  >
                    <ArrowUp className="size-3.5" aria-hidden />
                    Up
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onReorder(swapIds(items, idx, idx + 1))}
                    disabled={reorderPending || idx === items.length - 1}
                  >
                    <ArrowDown className="size-3.5" aria-hidden />
                    Down
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(item)}
                    disabled={busy || reorderPending}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onToggleActive(item)}
                    disabled={busy || reorderPending}
                  >
                    {item.isActive ? (
                      <>
                        <PowerOff className="size-3.5" aria-hidden />
                        Deactivate
                      </>
                    ) : (
                      <>
                        <Power className="size-3.5" aria-hidden />
                        Activate
                      </>
                    )}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function swapIds(items: MenuItemDTO[], from: number, to: number): string[] {
  if (to < 0 || to >= items.length) return items.map((x) => x.id);
  const ids = items.map((x) => x.id);
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}
