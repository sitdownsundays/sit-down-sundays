/**
 * Booking wizard Step 2 — guest meal card.
 *
 * One card per guest: package selection, included meat/side/bread selections
 * with count tracking, and individual add-ons with quantities. Client-safe.
 */
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  addonEligibleFor,
  copyMealImpact,
  eligibleFor,
  requiredCount,
  selectionCount,
  validateGuestSelections,
  type GuestAllocation,
} from "@/lib/booking/meals-helpers";
import type { PublicMealPackage, PublicOrderingCatalog } from "@/lib/booking/public-catalog";
import type { SelectionCategory } from "@/lib/ordering/constants";
import { CopyMealDialog } from "@/components/public/copy-meal-dialog";

interface Props {
  alloc: GuestAllocation;
  catalog: PublicOrderingCatalog;
  allocations: GuestAllocation[];
  onApplyPackage: (packageId: string) => void;
  onToggleSelection: (menuItemId: string, category: SelectionCategory) => void;
  onAddonQty: (addonId: string, quantity: number) => void;
  onCopyMeal: (sourceIndex: number, targetIndices: number[]) => void;
}

const CATEGORY_LABELS: Record<SelectionCategory, string> = {
  meat: "Meats",
  side: "Sides",
  bread: "Bread",
  drink: "Drink",
};

export function GuestMealCard({
  alloc,
  catalog,
  allocations,
  onApplyPackage,
  onToggleSelection,
  onAddonQty,
  onCopyMeal,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [copyOpen, setCopyOpen] = useState(false);
  const [pendingTargets, setPendingTargets] = useState<number[]>([]);
  const pkg: PublicMealPackage | undefined = alloc.packageId
    ? catalog.packages.find((p) => p.id === alloc.packageId)
    : undefined;
  const notes = validateGuestSelections(alloc, pkg);
  const categoryLabel = alloc.category.charAt(0).toUpperCase() + alloc.category.slice(1);
  const canCopy = !!pkg && notes.length === 0 && allocations.length > 1;

  const impact = copyMealImpact(allocations, alloc.guestIndex, pendingTargets, catalog.addons);

  const handleCopyConfirm = (targetIndices: number[]) => {
    setPendingTargets(targetIndices);
    onCopyMeal(alloc.guestIndex, targetIndices);
    setCopyOpen(false);
    setPendingTargets([]);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
        >
          {expanded ? (
            <ChevronUp className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-display text-base font-semibold text-foreground">{alloc.name}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {categoryLabel}
          </span>
          {pkg && <span className="text-sm text-muted-foreground">· {pkg.name}</span>}
        </button>
        {notes.length > 0 && (
          <span className="text-xs text-destructive" role="alert">
            {notes[0]}
          </span>
        )}
        {canCopy && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label={`Copy ${alloc.name}'s meal to other guests`}
            onClick={() => setCopyOpen(true)}
          >
            <Copy className="size-4" aria-hidden />
            <span className="hidden sm:inline">Copy meal to…</span>
          </Button>
        )}
      </div>

      {canCopy && (
        <CopyMealDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          source={alloc}
          allocations={allocations}
          catalog={catalog}
          replacingMeals={impact.replacingMeals}
          removingAddons={impact.removingAddons}
          onConfirm={handleCopyConfirm}
        />
      )}

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Package selection */}
          <div>
            <span className="text-sm font-medium text-foreground">Meal package</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {catalog.packages.map((p) => {
                const selected = alloc.packageId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onApplyPackage(p.id)}
                    aria-pressed={selected}
                    className={[
                      "rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:border-primary/40",
                    ].join(" ")}
                  >
                    <span className="block font-medium text-foreground">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.description}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {p.includedMeatsCount} meats · {p.includedSidesCount} sides
                      {p.includesBread ? " · bread" : ""}
                      {p.includesSoftDrink ? " · soft drink" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {pkg && (
            <>
              {/* Included selections */}
              <SelectionGroup
                label="Meats"
                category="meat"
                alloc={alloc}
                pkg={pkg}
                onToggle={onToggleSelection}
              />
              <SelectionGroup
                label="Sides"
                category="side"
                alloc={alloc}
                pkg={pkg}
                onToggle={onToggleSelection}
              />
              {pkg.includesBread && (
                <SelectionGroup
                  label="Bread choice"
                  category="bread"
                  alloc={alloc}
                  pkg={pkg}
                  onToggle={onToggleSelection}
                />
              )}
              {pkg.includesSoftDrink && (
                <p className="text-xs text-muted-foreground">
                  A soft drink is included with this meal (no extra charge).
                </p>
              )}

              {/* Individual add-ons */}
              <div>
                <span className="text-sm font-medium text-foreground">Individual add-ons</span>
                <div className="mt-2 space-y-2">
                  {catalog.addons
                    .filter((a) => addonEligibleFor(a, alloc.packageId))
                    .map((a) => {
                      const line = alloc.addons.find((x) => x.addonId === a.id);
                      const qty = line?.quantity ?? 0;
                      return (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-2"
                        >
                          <div className="min-w-0">
                            <span className="block text-sm font-medium text-foreground">
                              {a.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {a.description}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Fewer ${a.name}`}
                              onClick={() => onAddonQty(a.id, qty - 1)}
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
                              aria-label={`More ${a.name}`}
                              onClick={() => onAddonQty(a.id, qty + 1)}
                            >
                              +
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  {catalog.addons.filter((a) => addonEligibleFor(a, alloc.packageId)).length ===
                    0 && (
                    <p className="text-xs text-muted-foreground">
                      No individual add-ons available for this package.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SelectionGroup({
  label,
  category,
  alloc,
  pkg,
  onToggle,
}: {
  label: string;
  category: SelectionCategory;
  alloc: GuestAllocation;
  pkg: PublicMealPackage;
  onToggle: (menuItemId: string, category: SelectionCategory) => void;
}) {
  const items = eligibleFor(pkg, category);
  const required = requiredCount(pkg, category);
  const selected = selectionCount(alloc, category);
  const isSingle = category === "bread" || category === "drink";

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {!isSingle && required > 0 && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {selected} of {required} selected
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          const isSelected = alloc.included.some(
            (s) => s.menuItemId === item.menuItemId && s.selectionCategory === category,
          );
          return (
            <button
              key={item.menuItemId}
              type="button"
              onClick={() => onToggle(item.menuItemId, category)}
              aria-pressed={isSelected}
              className={[
                "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:border-primary/40",
              ].join(" ")}
            >
              {item.menuItemName}
            </button>
          );
        })}
        {items.length === 0 && (
          <span className="text-xs text-muted-foreground">
            No {CATEGORY_LABELS[category].toLowerCase()} configured for this package.
          </span>
        )}
      </div>
    </div>
  );
}
