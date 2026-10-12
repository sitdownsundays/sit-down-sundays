/**
 * Booking wizard Step 2 — party-wide feast selector.
 *
 * Replaces per-guest meal cards in the PUBLIC flow. ONE shared package + shared
 * included selections (meats, sides, one bread) for the entire party, served
 * family-style. Pricing is per person. A free soft drink is included with each
 * meal. Individual paid add-ons are removed from the public flow.
 *
 * Each guest allocation still retains its identity (guestId), category, name,
 * and any personal notes — the shared selections are applied to every guest as
 * independent copies. Shared platters remain a separate party-level section.
 */
import { ArrowLeft, ArrowRight, ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/layout/button-link";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { SharedPlattersSection } from "@/components/public/booking-shared-platters";
import { PricingEstimatePanel } from "@/components/public/booking-pricing-estimate";
import {
  eligibleFor,
  requiredCount,
  selectionCount,
  sharedSelectionCount,
  type GuestAllocation,
  type SharedFeastState,
} from "@/lib/booking/meals-helpers";
import type { PublicMealPackage, PublicOrderingCatalog } from "@/lib/booking/public-catalog";
import type { SelectionCategory } from "@/lib/ordering/constants";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";
import type { useBookingMeals } from "@/lib/booking/use-booking-meals";

type MealsHook = ReturnType<typeof useBookingMeals>;

interface Props {
  state: BookWizardState;
  meals: MealsHook;
  onBack: () => void;
  onContinue: () => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function MealsStep({ state, meals, onBack, onContinue }: Props) {
  const {
    catalog,
    catalogStatus,
    catalogError,
    loadCatalog,
    applySharedPackage,
    toggleSharedSelection: toggleShared,
    setPlatters,
    canContinueFromMeals,
    quote,
    quoteLoading,
    quoteError,
    retryQuote,
  } = meals;

  const hasPackages = (catalog?.packages.length ?? 0) > 0;
  const [pendingPackage, setPendingPackage] = useState<string | null>(null);

  const shared: SharedFeastState = {
    packageId: state.meals.allocations[0]?.packageId ?? null,
    included: state.meals.allocations[0]?.included ?? [],
  };
  const activePkg: PublicMealPackage | undefined = shared.packageId
    ? catalog?.packages.find((p) => p.id === shared.packageId)
    : undefined;

  const handleSelectPackage = (packageId: string) => {
    if (!catalog) return;
    const pkg = catalog.packages.find((p) => p.id === packageId);
    if (!pkg) return;
    // Confirm when existing meals would be discarded
    if (state.meals.allocations.some((a) => a.packageId || a.included.length > 0)) {
      setPendingPackage(packageId);
      return;
    }
    applySharedPackage(packageId);
  };

  const confirmPackage = () => {
    if (pendingPackage) applySharedPackage(pendingPackage);
    setPendingPackage(null);
  };

  return (
    <section aria-labelledby="step-meals-heading">
      <h2 id="step-meals-heading" className="font-display text-xl font-semibold text-foreground">
        2. Choose your family feast
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your party shares one package and the same dishes, served family-style. Pricing is per
        person. A soft drink is included with each meal.
      </p>

      {catalogStatus === "loading" && (
        <div className="mt-6">
          <LoadingState label="Loading the menu…" />
        </div>
      )}

      {catalogStatus === "error" && (
        <div className="mt-6">
          <ErrorState
            title="Couldn't load the menu"
            {...(catalogError ? { message: catalogError } : {})}
            action={
              <Button variant="outline" onClick={() => void loadCatalog()}>
                Try again
              </Button>
            }
          />
        </div>
      )}

      {catalogStatus === "success" && !hasPackages && (
        <div className="mt-6">
          <EmptyState
            title="No meal packages available"
            description="Our menu isn't configured yet. Please check back soon."
          />
        </div>
      )}

      {catalogStatus === "success" && hasPackages && catalog && (
        <div className="mt-6 space-y-6">
          {/* Package selector */}
          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Choose a meal package
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {catalog.packages.map((p) => {
                const selected = shared.packageId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPackage(p.id)}
                    aria-pressed={selected}
                    className={[
                      "rounded-md border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:border-primary/40",
                    ].join(" ")}
                  >
                    <span className="block font-medium text-foreground">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.description}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {formatCents(p.pricePerPersonCents)}/person
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {p.includedMeatsCount} meats · {p.includedSidesCount} sides
                      {p.includesBread ? " · bread" : ""}
                      {p.includesSoftDrink ? " · soft drink included" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Package-switch confirmation (controlled: opens on first click) */}
          <AlertDialog
            open={pendingPackage !== null}
            onOpenChange={(open) => {
              if (!open) {
                // Cancel or Escape — clear pending, leave state unchanged.
                setPendingPackage(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace existing choices?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingPackage
                    ? `Switching to ${
                        catalog.packages.find((p) => p.id === pendingPackage)?.name ??
                        "this package"
                      } will replace your party's current meal selections. Continue, or cancel to keep your current choices.`
                    : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={confirmPackage}
                >
                  Switch package
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Shared included selections */}
          {activePkg && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-5">
              <h3 className="font-display text-base font-semibold text-foreground">
                Choose your shared dishes
              </h3>

              <SharedSelectionGroup
                label="Meats"
                category="meat"
                allocations={state.meals.allocations}
                pkg={activePkg}
                onToggle={(menuItemId, category) => toggleShared(menuItemId, category)}
              />
              <SharedSelectionGroup
                label="Sides"
                category="side"
                allocations={state.meals.allocations}
                pkg={activePkg}
                onToggle={(menuItemId, category) => toggleShared(menuItemId, category)}
              />
              {activePkg.includesBread && (
                <SharedSelectionGroup
                  label="Bread choice"
                  category="bread"
                  allocations={state.meals.allocations}
                  pkg={activePkg}
                  onToggle={(menuItemId, category) => toggleShared(menuItemId, category)}
                />
              )}
              {activePkg.includesSoftDrink && (
                <p className="text-xs text-muted-foreground">
                  A soft drink is included with each meal (no extra charge).
                </p>
              )}
            </div>
          )}

          {/* Shared platters */}
          <SharedPlattersSection
            catalog={catalog}
            platters={state.meals.platters}
            onPlatterQty={setPlatters}
          />

          {/* Guest dietary needs */}
          <GuestDietaryNeeds
            allocations={state.meals.allocations}
            onGuestField={meals.setGuestField}
          />

          {/* Pricing estimate */}
          <PricingEstimatePanel
            result={quote}
            loading={quoteLoading}
            error={quoteError}
            onRetry={retryQuote}
          />

          {/* Unresolved pricing notice */}
          {quote?.ok && quote.hasUnresolvedRules && quote.unresolvedNotes && (
            <div
              role="alert"
              className="rounded-md border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-foreground"
            >
              <p className="font-medium">Some pricing isn't configured yet:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {quote.unresolvedNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Step 2 of 4</span>
              <Button
                type="button"
                onClick={onContinue}
                disabled={!canContinueFromMeals}
                title={
                  canContinueFromMeals
                    ? "Continue to your information"
                    : "Complete your meal selections to continue"
                }
              >
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" aria-hidden />
            Next: your contact information. No payment is collected at this step.
          </p>
        </div>
      )}

      {catalogStatus === "success" && hasPackages && (
        <div className="mt-4">
          <ButtonLink to="/" variant="ghost">
            <ArrowLeft className="size-4" aria-hidden />
            Back to website
          </ButtonLink>
        </div>
      )}
    </section>
  );
}

/**
 * Shared selection group — shows eligible items for a category with count
 * tracking derived from the first guest (party-wide). Toggling applies to
 * ALL guests.
 */
function SharedSelectionGroup({
  label,
  category,
  allocations,
  pkg,
  onToggle,
}: {
  label: string;
  category: SelectionCategory;
  allocations: GuestAllocation[];
  pkg: PublicMealPackage;
  onToggle: (menuItemId: string, category: SelectionCategory) => void;
}) {
  const items = eligibleFor(pkg, category);
  const required = requiredCount(pkg, category);
  const selected = sharedSelectionCount(allocations, category);
  const isSingle = category === "bread" || category === "drink";

  // Count from the first guest's included selections (party-wide).
  const firstIncluded = allocations[0]?.included ?? [];

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
          const isSelected = firstIncluded.some(
            (s) => s.menuItemId === item.menuItemId && s.selectionCategory === category,
          );
          return (
            <button
              key={item.menuItemId}
              type="button"
              onClick={() => onToggle(item.menuItemId, category)}
              aria-pressed={isSelected}
              className={[
                "rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
            No {label.toLowerCase()} configured for this package.
          </span>
        )}
      </div>
    </div>
  );
}

const MAX_NOTE_LENGTH = 1000;

type GuestField = "name" | "foodAllergies" | "dietaryPreferences" | "mealRequests";

const NOTE_FIELDS: Array<{
  field: Exclude<GuestField, "name">;
  label: string;
  id: string;
  placeholder: string;
}> = [
  {
    field: "foodAllergies",
    label: "Food allergies",
    id: "foodAllergies",
    placeholder: "e.g. peanuts, shellfish",
  },
  {
    field: "dietaryPreferences",
    label: "Dietary preferences / restrictions",
    id: "dietaryPreferences",
    placeholder: "e.g. vegetarian, gluten-free",
  },
  {
    field: "mealRequests",
    label: "Meal-specific requests",
    id: "mealRequests",
    placeholder: "e.g. no salt, extra gravy",
  },
];

/**
 * Collapsible per-guest dietary needs section. The party shares ONE feast;
 * this section collects each guest's personal name, allergies, dietary
 * preferences, and meal requests. Notes are attached to the stable guestId so
 * they survive party reconciliation. Requests require staff review — entering a
 * note does not confirm an accommodation.
 */
function GuestDietaryNeeds({
  allocations,
  onGuestField,
}: {
  allocations: GuestAllocation[];
  onGuestField: (guestId: string, field: GuestField, value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (allocations.length === 0) return null;

  const guestsWithNotes = allocations.filter(
    (a) =>
      a.foodAllergies.trim() !== "" ||
      a.dietaryPreferences.trim() !== "" ||
      a.mealRequests.trim() !== "",
  ).length;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="guest-dietary-needs"
        className="flex w-full items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
          <span className="font-display text-base font-semibold text-foreground">
            Guest dietary needs
          </span>
          {guestsWithNotes > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Notes added · {guestsWithNotes}
            </span>
          )}
        </span>
      </button>

      <p className="mt-2 text-xs text-muted-foreground">
        Your party shares one feast. Tell us who needs special attention. Requests require staff
        review; entering a note does not confirm an accommodation.
      </p>

      {open && (
        <div id="guest-dietary-needs" className="mt-4 space-y-4">
          {allocations.map((alloc) => {
            const categoryLabel = alloc.category.charAt(0).toUpperCase() + alloc.category.slice(1);
            const label = alloc.name.trim() || `Guest ${alloc.guestIndex + 1}`;
            const hasNotes =
              alloc.foodAllergies.trim() !== "" ||
              alloc.dietaryPreferences.trim() !== "" ||
              alloc.mealRequests.trim() !== "";
            return (
              <div
                key={alloc.guestId}
                className="rounded-md border border-border bg-background p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {categoryLabel}
                  </span>
                  {hasNotes && (
                    <span className="text-xs font-medium text-primary">Notes added</span>
                  )}
                </div>

                <div className="mt-3 space-y-3">
                  <div>
                    <Label htmlFor={`guest-name-${alloc.guestId}`} className="text-xs">
                      Guest name (optional)
                    </Label>
                    <Input
                      id={`guest-name-${alloc.guestId}`}
                      type="text"
                      value={alloc.name}
                      maxLength={MAX_NOTE_LENGTH}
                      onChange={(e) => onGuestField(alloc.guestId, "name", e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  {NOTE_FIELDS.map(({ field, label: fieldLabel, id, placeholder }) => {
                    const value = alloc[field];
                    const over = value.length > MAX_NOTE_LENGTH;
                    return (
                      <div key={field}>
                        <Label htmlFor={`${id}-${alloc.guestId}`} className="text-xs">
                          {fieldLabel} (optional)
                        </Label>
                        <Textarea
                          id={`${id}-${alloc.guestId}`}
                          value={value}
                          maxLength={MAX_NOTE_LENGTH}
                          placeholder={placeholder}
                          onChange={(e) => onGuestField(alloc.guestId, field, e.target.value)}
                          className="mt-1 min-h-[60px]"
                          aria-invalid={over}
                          aria-describedby={over ? `${id}-err-${alloc.guestId}` : undefined}
                        />
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {value.length}/{MAX_NOTE_LENGTH}
                          </span>
                          {over && (
                            <span
                              id={`${id}-err-${alloc.guestId}`}
                              role="alert"
                              className="text-xs text-destructive"
                            >
                              Maximum {MAX_NOTE_LENGTH} characters.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
