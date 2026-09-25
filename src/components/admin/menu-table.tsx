/**
 * Admin Menus — responsive menu list (desktop table + mobile cards).
 *
 * Archived menus cannot be edited, published, or restored from this view:
 * the Edit button is hidden when status === "archived". Publish/Archive
 * buttons are disabled while an action is pending for that menu to prevent
 * double-submits.
 */
import { Archive, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/layout/status-badge";
import type { MenuWithContentDTO } from "@/lib/menu/types";
import { formatDate, formatDateOnly, statusTone } from "./menu-form-helpers";

interface MenuTableProps {
  menus: MenuWithContentDTO[];
  onEdit: (menu: MenuWithContentDTO) => void;
  onPublish: (menu: MenuWithContentDTO) => void;
  onArchive: (menu: MenuWithContentDTO) => void;
  /** Menu id currently undergoing a publish/archive action; its action
   *  buttons are disabled to prevent double-submits. */
  pendingId?: string | null;
}

export function MenuTable({ menus, onEdit, onPublish, onArchive, pendingId }: MenuTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
      {/* Desktop / tablet table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Menus</caption>
          <thead className="border-b border-border bg-muted/40 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Menu
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Publish window
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Items
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Updated
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold text-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {menus.map((menu) => {
              const busy = pendingId === menu.id;
              return (
                <tr key={menu.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{menu.name}</p>
                    <p className="text-xs text-muted-foreground">/{menu.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(menu.status)}>{menu.status}</StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <p>{formatDateOnly(menu.publishAt)}</p>
                    <p className="text-xs">to {formatDateOnly(menu.unpublishAt)}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{menu.items.length}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(menu.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {menu.status !== "archived" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEdit(menu)}
                          disabled={busy}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          Edit
                        </Button>
                      )}
                      {menu.status !== "published" && menu.status !== "archived" && (
                        <Button size="sm" onClick={() => onPublish(menu)} disabled={busy}>
                          <Send className="size-3.5" aria-hidden />
                          Publish
                        </Button>
                      )}
                      {menu.status !== "archived" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onArchive(menu)}
                          disabled={busy}
                        >
                          <Archive className="size-3.5" aria-hidden />
                          Archive
                        </Button>
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
        {menus.map((menu) => {
          const busy = pendingId === menu.id;
          return (
            <li key={menu.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{menu.name}</p>
                  <p className="truncate text-xs text-muted-foreground">/{menu.slug}</p>
                </div>
                <StatusBadge tone={statusTone(menu.status)}>{menu.status}</StatusBadge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt className="font-medium text-foreground/70">Items</dt>
                <dd>{menu.items.length}</dd>
                <dt className="font-medium text-foreground/70">Publish</dt>
                <dd>{formatDateOnly(menu.publishAt)}</dd>
                <dt className="font-medium text-foreground/70">Unpublish</dt>
                <dd>{formatDateOnly(menu.unpublishAt)}</dd>
                <dt className="font-medium text-foreground/70">Updated</dt>
                <dd>{formatDate(menu.updatedAt)}</dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {menu.status !== "archived" && (
                  <Button variant="outline" size="sm" onClick={() => onEdit(menu)} disabled={busy}>
                    <Pencil className="size-3.5" aria-hidden />
                    Edit
                  </Button>
                )}
                {menu.status !== "published" && menu.status !== "archived" && (
                  <Button size="sm" onClick={() => onPublish(menu)} disabled={busy}>
                    <Send className="size-3.5" aria-hidden />
                    Publish
                  </Button>
                )}
                {menu.status !== "archived" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onArchive(menu)}
                    disabled={busy}
                  >
                    <Archive className="size-3.5" aria-hidden />
                    Archive
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
