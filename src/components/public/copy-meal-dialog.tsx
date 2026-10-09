/**
 * Booking wizard Step 2 — "Copy meal to…" dialog.
 *
 * Lets a guest with a complete, valid meal copy their package and included
 * meat/side/bread selections to other guests. Paid extras are NOT copied.
 * Client-safe.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { eligibleFor, selectionCount, type GuestAllocation } from "@/lib/booking/meals-helpers";
import type { PublicMealPackage, PublicOrderingCatalog } from "@/lib/booking/public-catalog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: GuestAllocation;
  allocations: GuestAllocation[];
  catalog: PublicOrderingCatalog;
  /** Recipient indices that would lose configured meals. */
  replacingMeals: number[];
  /** Recipient indices whose add-ons are incompatible. */
  removingAddons: number[];
  onConfirm: (targetIndices: number[]) => void;
}

export function CopyMealDialog({
  open,
  onOpenChange,
  source,
  allocations,
  catalog,
  replacingMeals,
  removingAddons,
  onConfirm,
}: Props) {
  const others = allocations.filter((a) => a.guestIndex !== source.guestIndex);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Reset selection when dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next) setSelected(new Set());
    onOpenChange(next);
  };

  const pkg: PublicMealPackage | undefined = source.packageId
    ? catalog.packages.find((p) => p.id === source.packageId)
    : undefined;

  const sourceMeats = pkg ? selectionCount(source, "meat") : 0;
  const sourceSides = pkg ? selectionCount(source, "side") : 0;
  const sourceBread = selectionCount(source, "bread");

  const meatNames = pkg
    ? source.included
        .filter((s) => s.selectionCategory === "meat")
        .map(
          (s) => eligibleFor(pkg, "meat").find((e) => e.menuItemId === s.menuItemId)?.menuItemName,
        )
        .filter(Boolean)
    : [];
  const sideNames = pkg
    ? source.included
        .filter((s) => s.selectionCategory === "side")
        .map(
          (s) => eligibleFor(pkg, "side").find((e) => e.menuItemId === s.menuItemId)?.menuItemName,
        )
        .filter(Boolean)
    : [];
  const breadName = pkg
    ? source.included.find((s) => s.selectionCategory === "bread")?.menuItemId
    : undefined;
  const breadLabel =
    pkg && breadName
      ? eligibleFor(pkg, "bread").find((e) => e.menuItemId === breadName)?.menuItemName
      : undefined;

  const toggleAll = () => {
    if (selected.size === others.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(others.map((a) => a.guestIndex)));
    }
  };

  const toggleOne = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selected).sort((a, b) => a - b));
    setSelected(new Set());
  };

  const categoryLabel = (cat: string) => cat.charAt(0).toUpperCase() + cat.slice(1);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy meal to…</DialogTitle>
          <DialogDescription>
            Copies the package and included dishes. Paid extras are not copied.
          </DialogDescription>
        </DialogHeader>

        {/* Source summary */}
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium text-foreground">
            From {source.name} ({categoryLabel(source.category)})
          </p>
          {pkg ? (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li>Package: {pkg.name}</li>
              <li>
                Meats ({sourceMeats}): {meatNames.join(", ") || "—"}
              </li>
              <li>
                Sides ({sourceSides}): {sideNames.join(", ") || "—"}
              </li>
              {pkg.includesBread && <li>Bread: {breadLabel || "—"}</li>}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No package selected.</p>
          )}
        </div>

        {/* Recipient selection */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="copy-meal-select-all"
              checked={others.length > 0 && selected.size === others.length}
              onCheckedChange={toggleAll}
              disabled={others.length === 0}
            />
            <label htmlFor="copy-meal-select-all" className="text-sm font-medium text-foreground">
              Select all other guests
            </label>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {others.map((a) => {
              const checked = selected.has(a.guestIndex);
              const willReplace = replacingMeals.includes(a.guestIndex);
              const willRemoveAddons = removingAddons.includes(a.guestIndex);
              return (
                <label
                  key={a.guestId}
                  htmlFor={`copy-meal-target-${a.guestIndex}`}
                  className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/30"
                >
                  <Checkbox
                    id={`copy-meal-target-${a.guestIndex}`}
                    checked={checked}
                    onCheckedChange={() => toggleOne(a.guestIndex)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {a.name} · {categoryLabel(a.category)}
                    </span>
                    {checked && willReplace && (
                      <span className="block text-xs text-destructive">
                        Replaces their current meal selection.
                      </span>
                    )}
                    {checked && willRemoveAddons && (
                      <span className="block text-xs text-destructive">
                        Removes add-ons incompatible with this package.
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
            {others.length === 0 && (
              <p className="text-xs text-muted-foreground">No other guests to copy to.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={selected.size === 0}>
            Copy meal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
