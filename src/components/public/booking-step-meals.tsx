/**
 * Booking wizard Step 2 — Meals & extras.
 * Extracted from the wizard so the main component stays focused.
 */
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import type { PublicOrderingCatalog } from "@/lib/booking/public-catalog";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";
import type { SelectionCategory } from "@/lib/ordering/constants";
import type { QuoteResult } from "@/lib/public-quote.functions";
import { GuestMealCard } from "@/components/public/booking-guest-meal-card";
import { SharedPlattersSection } from "@/components/public/booking-shared-platters";
import { PricingEstimatePanel } from "@/components/public/booking-pricing-estimate";

interface Props {
  state: BookWizardState;
  catalog: PublicOrderingCatalog | null;
  catalogStatus: "loading" | "success" | "error";
  catalogError: string | null;
  quoteResult: QuoteResult | null;
  quoteLoading: boolean;
  quoteError: string | null;
  onRetryCatalog: () => void;
  onRetryQuote: () => void;
  onApplyPackageToGuest: (guestIndex: number, packageId: string) => void;
  onApplyPackageToAll: (packageId: string) => void;
  onToggleSelection: (guestIndex: number, menuItemId: string, category: SelectionCategory) => void;
  onAddonQty: (guestIndex: number, addonId: string, quantity: number) => void;
  onPlatterQty: (platters: Array<{ platterId: string; quantity: number }>) => void;
  onBack: () => void;
}

export function BookingStepMeals({
  state,
  catalog,
  catalogStatus,
  catalogError,
  quoteResult,
  quoteLoading,
  quoteError,
  onRetryCatalog,
  onRetryQuote,
  onApplyPackageToGuest,
  onApplyPackageToAll,
  onToggleSelection,
  onAddonQty,
  onPlatterQty,
  onBack,
}: Props) {
  return (
    <section aria-labelledby="step-meals-heading">
      <h2 id="step-meals-heading" className="font-display text-xl font-semibold text-foreground">
        2. Meals &amp; extras
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a meal package for each guest, then pick their meats, sides, and bread. Add
        individual extras per guest or shared platters for the table.
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
            message={catalogError ?? undefined}
            action={
              <Button variant="outline" onClick={onRetryCatalog}>
                Try again
              </Button>
            }
          />
        </div>
      )}

      {catalogStatus === "success" && catalog && (
        <div className="mt-6 space-y-6">
          {catalog.packages.length === 0 && (
            <EmptyState
              title="No meal packages available"
              description="Our menu isn't configured yet. Please check back soon."
            />
          )}

          {catalog.packages.length > 0 && state.meals.allocations.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-display text-base font-semibold text-foreground">
                Quick start — apply a meal to all guests
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Apply one package to everyone, then customize individual guests below. This replaces
                any existing choices.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {catalog.packages.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onApplyPackageToAll(p.id)}
                  >
                    {p.name} — ${(p.pricePerPersonCents / 100).toFixed(2)}/person
                  </Button>
                ))}
              </div>
            </div>
          )}

          {state.meals.allocations.map((alloc) => (
            <GuestMealCard
              key={alloc.guestId}
              alloc={alloc}
              catalog={catalog}
              onApplyPackage={(pkgId) => onApplyPackageToGuest(alloc.guestIndex, pkgId)}
              onToggleSelection={(menuItemId, category) =>
                onToggleSelection(alloc.guestIndex, menuItemId, category)
              }
              onAddonQty={(addonId, qty) => onAddonQty(alloc.guestIndex, addonId, qty)}
            />
          ))}

          <SharedPlattersSection
            catalog={catalog}
            platters={state.meals.platters}
            onPlatterQty={onPlatterQty}
          />

          <PricingEstimatePanel
            result={quoteResult}
            loading={quoteLoading}
            error={quoteError}
            onRetry={onRetryQuote}
          />

          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Step 2 of 4</span>
              <Button type="button" disabled title="Your information is under development">
                Continue
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Next step (your information) is under development. No reservation request is submitted
            from this page yet.
          </p>
        </div>
      )}
    </section>
  );
}
