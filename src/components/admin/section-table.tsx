/**
 * Admin Menu Sections — responsive section list with reorder controls.
 *
 * Sections are shown in display order. Each row offers move-up / move-down
 * controls that reorder the complete list atomically through the existing
 * reorderSections server function. Deactivation requires confirmation and
 * is handled by the parent panel. Action buttons are disabled while an
 * action is pending for that section to prevent double-submits.
 */
import { ArrowDown, ArrowUp, Pencil, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/layout/status-badge";
import type { MenuSectionDTO } from "@/lib/menu/types";
import { formatDate } from "./menu-form-helpers";

interface SectionTableProps {
  sections: MenuSectionDTO[];
  onEdit: (section: MenuSectionDTO) => void;
  onToggleActive: (section: MenuSectionDTO) => void;
  onReorder: (orderedIds: string[]) => void;
  /** Section id currently undergoing an action; its buttons are disabled. */
  pendingId?: string | null;
  reorderPending?: boolean;
  /** When true (archived menu), all edit/activation/reorder controls are disabled. */
  readOnly?: boolean;
}

export function SectionTable({
  sections,
  onEdit,
  onToggleActive,
  onReorder,
  pendingId,
  reorderPending,
  readOnly = false,
}: SectionTableProps) {
  function move(index: number, direction: -1 | 1) {
    if (readOnly) return;
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const ids = sections.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
      {/* Desktop / tablet table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Menu sections</caption>
          <thead className="border-b border-border bg-muted/40 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Order
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Section
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                Status
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
            {sections.map((section, index) => {
              const busy = pendingId === section.id;
              const anyPending = busy || !!reorderPending || readOnly;
              return (
                <tr key={section.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{index + 1}</span>
                      <div className="flex flex-col">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          aria-label={`Move “${section.name}” up`}
                          onClick={() => move(index, -1)}
                          disabled={index === 0 || anyPending}
                        >
                          <ArrowUp className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          aria-label={`Move “${section.name}” down`}
                          onClick={() => move(index, 1)}
                          disabled={index === sections.length - 1 || anyPending}
                        >
                          <ArrowDown className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{section.name}</p>
                    {section.description && (
                      <p className="text-xs text-muted-foreground">{section.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={section.isActive ? "success" : "neutral"}>
                      {section.isActive ? "active" : "inactive"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(section.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(section)}
                        disabled={anyPending}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onToggleActive(section)}
                        disabled={anyPending}
                      >
                        {section.isActive ? (
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-border md:hidden">
        {sections.map((section, index) => {
          const busy = pendingId === section.id;
          const anyPending = busy || !!reorderPending || readOnly;
          return (
            <li key={section.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    <span className="text-xs text-muted-foreground">#{index + 1} </span>
                    {section.name}
                  </p>
                  {section.description && (
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  )}
                </div>
                <StatusBadge tone={section.isActive ? "success" : "neutral"}>
                  {section.isActive ? "active" : "inactive"}
                </StatusBadge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt className="font-medium text-foreground/70">Updated</dt>
                <dd>{formatDate(section.updatedAt)}</dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || anyPending}
                  aria-label={`Move “${section.name}” up`}
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                  Up
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => move(index, 1)}
                  disabled={index === sections.length - 1 || anyPending}
                  aria-label={`Move “${section.name}” down`}
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                  Down
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(section)}
                  disabled={anyPending}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onToggleActive(section)}
                  disabled={anyPending}
                >
                  {section.isActive ? (
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
