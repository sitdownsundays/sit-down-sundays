/**
 * Booking wizard — customer-facing reservation request flow.
 *
 * Steps implemented:
 *  1. Sunday & guests — availability + party composition.
 *  2. Meals & extras — packages, per-guest selections, add-ons, platters,
 *     server-authoritative pricing estimate.
 * Steps 3–4 are clearly marked as under development and do not fake a
 * successful Continue action.
 *
 * Uses existing server functions (anonymous/RLS-backed read path). No direct
 * browser database access, no mock fallback.
 *
 * configuredRequestCeiling is a REQUEST-SIZE LIMIT, not remaining seats.
 * Service dates are displayed in the restaurant timezone — never the browser
 * timezone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarDays, Clock, Minus, Plus, Users } from "lucide-react";

import {
  getPublicAvailability,
  getPublicOrderingCatalog,
  submitReservationRequest,
} from "@/lib/reservation.functions";
import { quoteOrder } from "@/lib/public-quote.functions";
import type { PublicAvailabilityOption } from "@/lib/reservation/types";
import type { QuoteResult } from "@/lib/public-quote.functions";
import { reconcileSharedFeast } from "@/lib/booking/meals-helpers";
import { useBookingMeals } from "@/lib/booking/use-booking-meals";
import { MealsStep } from "@/components/public/booking-meals-step";
import { InfoStep } from "@/components/public/booking-info-step";
import { ReviewStep } from "@/components/public/booking-review-step";
import { OptionCard } from "@/components/public/booking-option-card";
import { useSubmissionController } from "@/lib/booking/use-submission-controller";
import { validateContact } from "@/lib/booking/contact-rules";

import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/layout/button-link";
import { ConfirmationDialog } from "@/components/layout/confirmation-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";

import {
  BOOK_STEPS,
  STEP_LABELS,
  type BookStep,
  type BookWizardState,
  type SundayGroup,
  applyRefresh,
  capacityFromOption,
  findOption,
  formatServiceDate,
  formatSeatingTime,
  groupOptionsBySunday,
  initialWizardState,
  reconcileSelection,
  totalGuests,
  validateParty,
  validatePartyCapacity,
} from "@/lib/booking/wizard-helpers";

type LoadStatus = "loading" | "success" | "error";

export function BookingWizard() {
  const getAvailability = useServerFn(getPublicAvailability);
  const getCatalogFn = useServerFn(getPublicOrderingCatalog);
  const getQuoteFn = useServerFn(quoteOrder);
  const submitFn = useServerFn(submitReservationRequest);

  const [options, setOptions] = useState<PublicAvailabilityOption[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [state, setState] = useState<BookWizardState>(initialWizardState);
  const [notice, setNotice] = useState<string | null>(null);

  // Request-generation guard: an older async response cannot overwrite a
  // newer refresh.
  const reqGen = useRef(0);
  // Live mirror of wizard state so the async refresh handler reconciles against
  // the LATEST selection/counts (including edits made while a request is in
  // flight) instead of the stale closure value. Updated via an effect.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadAvailability = useCallback(async () => {
    const gen = ++reqGen.current;
    setLoadStatus("loading");
    setLoadError(null);
    try {
      const result = await getAvailability();
      if (gen !== reqGen.current) return; // stale response
      if (!result.ok) {
        setLoadStatus("error");
        setLoadError(result.error ?? "We couldn't load available Sundays. Please try again.");
        return;
      }
      setOptions(result.options);
      // Reconcile against the LATEST wizard state (stateRef), not the stale
      // closure value, so edits made during the request are preserved.
      const next = applyRefresh(stateRef.current, result.options);
      if (next.state !== stateRef.current) {
        setState(next.state);
      }
      if (next.notice) {
        setNotice(next.notice);
      } else if (next.state.sundayServiceId !== null && stateRef.current.sundayServiceId === null) {
        // A previously-cleared selection was restored by an earlier action; no
        // stale notice should linger.
        setNotice(null);
      }
      setLoadStatus("success");
    } catch {
      if (gen !== reqGen.current) return;
      setLoadStatus("error");
      setLoadError("We couldn't load available Sundays. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  // Step 2 meals hook. Server functions are injected as STABLE wrappers so
  // their identities don't change every render and trigger the quote effect
  // to restart endlessly. useServerFn already returns stable references; the
  // thin adapters below are memoized so the hook's internal useCallback deps
  // (which depend on getCatalog/getQuote) stay stable across renders.
  const catalogAdapter = useCallback(
    async (): ReturnType<typeof getCatalogFn> => getCatalogFn(),
    [getCatalogFn],
  );
  const quoteAdapter = useCallback(
    async (input: { data: Record<string, unknown> }) => getQuoteFn(input),
    [getQuoteFn],
  );

  const meals = useBookingMeals({
    state,
    setState,
    getCatalog: catalogAdapter,
    getQuote: quoteAdapter,
  });

  // Step 4 submission controller. Owned by the wizard (not the review step)
  // so the idempotency key + submitted payload survive review-step unmounting.
  // If the user clicks Edit/Back after an uncertain outcome, returning to
  // review reuses the SAME key + payload to recover the original result.
  const submission = useSubmissionController(async (input) => submitFn(input));

  const groups: SundayGroup[] = loadStatus === "success" ? groupOptionsBySunday(options) : [];
  const selectedCapacity = capacityFromOption(state.selectedOption);
  const party = validatePartyCapacity(state, selectedCapacity);
  const guestCount = totalGuests(state);

  const selectOption = useCallback((opt: PublicAvailabilityOption) => {
    setState((s) => ({
      ...s,
      sundayServiceId: opt.sundayService.id,
      seatingTimeId: opt.seatingTime.id,
      selectedOption: opt,
    }));
    setNotice(null);
  }, []);

  const setCount = useCallback((field: "adults" | "seniors" | "children", value: number) => {
    const safe = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    setState((s) => ({ ...s, [field]: safe }));
    setNotice(null);
  }, []);

  const adjustCount = useCallback((field: "adults" | "seniors" | "children", delta: number) => {
    setState((s) => {
      const next = Math.max(0, s[field] + delta);
      return { ...s, [field]: next };
    });
    setNotice(null);
  }, []);

  // Step 1 → Step 2: reconcile guest allocations against the current party
  // composition. Preserves compatible guests (same category) and their meal
  // selections; only discards configured meals for guests whose category is no
  // longer present. If any meals would be discarded, confirm first; Cancel
  // keeps the user on Step 1 with recoverable meal selections intact.
  const [pendingReconcile, setPendingReconcile] = useState<{
    adults: number;
    seniors: number;
    children: number;
    removed: string[];
  } | null>(null);

  const goToMeals = useCallback(() => {
    // Guard the handler itself, not just the disabled button: loading/error
    // states, missing/invalid capacity, and over-capacity party sizes must all
    // block progression before any state changes or meal reconciliation.
    if (loadStatus !== "success") return;
    const cap = capacityFromOption(stateRef.current.selectedOption);
    if (!cap) return;
    const partyCheck = validatePartyCapacity(stateRef.current, cap);
    if (partyCheck.error) return;
    // Compute reconciliation OUTSIDE the setState updater so side effects
    // (setPendingReconcile) are not called inside a pure state transition.
    // Use the shared-feast reconciliation so NEW guests inherit the existing
    // uniform package + selections (public party-wide booking).
    const rec = reconcileSharedFeast(
      stateRef.current.meals.allocations,
      stateRef.current.adults,
      stateRef.current.seniors,
      stateRef.current.children,
    );
    const hasConfiguredMeals = stateRef.current.meals.allocations.some(
      (a) => a.packageId !== null || a.included.length > 0 || a.addons.length > 0,
    );
    if (hasConfiguredMeals && rec.removed.length > 0) {
      setPendingReconcile({
        adults: stateRef.current.adults,
        seniors: stateRef.current.seniors,
        children: stateRef.current.children,
        removed: rec.removed,
      });
      return; // stay on Step 1 until confirmed
    }
    setState((s) => ({
      ...s,
      step: "meals" as BookStep,
      meals: { ...s.meals, allocations: rec.allocations },
    }));
  }, [loadStatus]);

  const confirmReconcile = useCallback(() => {
    if (!pendingReconcile) return;
    // Use the shared-feast reconciliation in the confirmed party-reduction
    // path too, so the behavior is consistent with the normal Continue path.
    const rec = reconcileSharedFeast(
      stateRef.current.meals.allocations,
      pendingReconcile.adults,
      pendingReconcile.seniors,
      pendingReconcile.children,
    );
    setState((s) => ({
      ...s,
      step: "meals" as BookStep,
      meals: { ...s.meals, allocations: rec.allocations },
    }));
    setPendingReconcile(null);
  }, [pendingReconcile]);

  const cancelReconcile = useCallback(() => {
    // Cancel: preserve recoverable meal selections, stay on Step 1.
    setPendingReconcile(null);
  }, []);

  const backToSunday = useCallback(() => {
    setState((s) => ({ ...s, step: "sunday" as BookStep }));
  }, []);

  // Step 2 → Step 3: advance only when meal selections are complete AND a
  // current, successful, resolved quote exists for those exact inputs. Uses
  // the shared readiness condition from the meals hook so the Continue button
  // and this guard can never disagree.
  const goToInfo = useCallback(() => {
    if (!meals.canContinueFromMeals) return;
    setState((s) => ({ ...s, step: "info" as BookStep }));
  }, [meals.canContinueFromMeals]);

  const backToMeals = useCallback(() => {
    setState((s) => ({ ...s, step: "meals" as BookStep }));
  }, []);

  // Step 3 → Step 4: advance only when contact validation passes. Step 4
  // (review & submit) remains under development in this run.
  const goToReview = useCallback(() => {
    const { valid } = validateContact(stateRef.current);
    if (!valid) return;
    setState((s) => ({ ...s, step: "review" as BookStep }));
  }, []);

  const setContactField = useCallback((field: keyof BookWizardState["contact"], value: string) => {
    setState((s) => ({ ...s, contact: { ...s.contact, [field]: value } }));
  }, []);

  const canContinueStep1 =
    loadStatus === "success" &&
    state.sundayServiceId !== null &&
    state.seatingTimeId !== null &&
    selectedCapacity !== null &&
    party.error === null &&
    guestCount >= 1;

  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="Reservations"
        title="Request a Reservation"
        description="Choose a Sunday, tell us your party size, and we'll take it from there. Your reservation request is subject to availability and staff review."
      />

      {/* Step indicator */}
      <ol className="mt-8 flex flex-wrap gap-2" aria-label="Booking steps">
        {STEP_LABELS.map((s, i) => {
          const active = s.id === state.step;
          const done = BOOK_STEPS.indexOf(state.step) > i;
          return (
            <li key={s.id}>
              <span
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : done
                      ? "border-primary/40 bg-primary/5 text-primary/70"
                      : "border-border bg-card text-muted-foreground",
                ].join(" ")}
                aria-current={active ? "step" : undefined}
              >
                <span className="font-medium">{i + 1}</span>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="order-2 lg:order-1">
          {/* STEP 1 — Sunday & guests */}
          {state.step === "sunday" && (
            <section aria-labelledby="step-sunday-heading">
              <h2
                id="step-sunday-heading"
                className="font-display text-xl font-semibold text-foreground"
              >
                1. Sunday &amp; guests
              </h2>

              {loadStatus === "loading" && (
                <div className="mt-6">
                  <LoadingState label="Loading available Sundays…" />
                </div>
              )}

              {loadStatus === "error" && (
                <div className="mt-6">
                  <ErrorState
                    title="Couldn't load availability"
                    {...(loadError ? { message: loadError } : {})}
                    action={
                      <Button variant="outline" onClick={() => void loadAvailability()}>
                        Try again
                      </Button>
                    }
                  />
                </div>
              )}

              {loadStatus === "success" && groups.length === 0 && (
                <div className="mt-6">
                  <EmptyState
                    title="No Sundays available right now"
                    description="Booking isn't open yet. Please check back soon or join the waitlist to be notified."
                    action={
                      <ButtonLink to="/waitlist" variant="outline">
                        Join the waitlist
                      </ButtonLink>
                    }
                  />
                </div>
              )}

              {notice && (
                <div
                  role="status"
                  className="mt-4 rounded-md border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-foreground"
                >
                  {notice}
                </div>
              )}

              {loadStatus === "success" && groups.length > 0 && (
                <div className="mt-6 space-y-6">
                  {groups.map((group) => {
                    const tz = group.options[0]?.restaurantTimezone || "America/Chicago";
                    return (
                      <div
                        key={group.serviceId}
                        className="rounded-lg border border-border bg-card p-5"
                      >
                        <div className="flex items-start gap-3">
                          <CalendarDays className="mt-0.5 size-5 text-primary" aria-hidden />
                          <div>
                            <h3 className="font-display text-lg font-semibold text-foreground">
                              {formatServiceDate(group.date, tz)}
                            </h3>
                            {group.serviceLabel && (
                              <p className="text-sm text-muted-foreground">{group.serviceLabel}</p>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {group.options.map((o) => (
                            <OptionCard
                              key={o.seatingTime.id}
                              option={o}
                              selected={
                                state.sundayServiceId === o.sundayService.id &&
                                state.seatingTimeId === o.seatingTime.id
                              }
                              onSelect={selectOption}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Party composition */}
              <div className="mt-8 rounded-lg border border-border bg-card p-5">
                <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
                  <Users className="size-5 text-primary" aria-hidden />
                  Your party
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tell us how many guests are in your party. We'll keep your whole group together in
                  one request.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <PartyCounter
                    label="Adults"
                    value={state.adults}
                    onDecrement={() => adjustCount("adults", -1)}
                    onIncrement={() => adjustCount("adults", 1)}
                    onChange={(v) => setCount("adults", v)}
                  />
                  <PartyCounter
                    label="Seniors"
                    value={state.seniors}
                    onDecrement={() => adjustCount("seniors", -1)}
                    onIncrement={() => adjustCount("seniors", 1)}
                    onChange={(v) => setCount("seniors", v)}
                  />
                  <PartyCounter
                    label="Children"
                    value={state.children}
                    onDecrement={() => adjustCount("children", -1)}
                    onIncrement={() => adjustCount("children", 1)}
                    onChange={(v) => setCount("children", v)}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total guests</span>
                  <span className="font-medium text-foreground" aria-live="polite">
                    {guestCount}
                  </span>
                </div>

                {party.error && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {party.error}
                  </p>
                )}

                {selectedCapacity !== null &&
                  guestCount > 0 &&
                  guestCount <= selectedCapacity.maxBookablePartySize && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Within the {selectedCapacity.maxBookablePartySize}-guest limit for this
                      seating.
                    </p>
                  )}
              </div>

              {/* Navigation */}
              <div className="mt-8 flex items-center justify-between">
                <ButtonLink to="/" variant="ghost">
                  <ArrowLeft className="size-4" aria-hidden />
                  Back to website
                </ButtonLink>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Step 1 of 4</span>
                  {pendingReconcile ? (
                    <ConfirmationDialog
                      trigger={<Button type="button">Continue</Button>}
                      title="Remove guest meal selections?"
                      description={`Changing your party will remove the meal selections for: ${pendingReconcile.removed.join(
                        ", ",
                      )}. Continue to update your party, or cancel to keep your current selections.`}
                      confirmLabel="Update party"
                      cancelLabel="Cancel"
                      destructive
                      onConfirm={confirmReconcile}
                    />
                  ) : (
                    <Button
                      type="button"
                      onClick={goToMeals}
                      disabled={!canContinueStep1}
                      title={
                        canContinueStep1
                          ? "Continue to meals & extras"
                          : "Choose a Sunday and enter your party size to continue"
                      }
                    >
                      Continue
                    </Button>
                  )}
                </div>
              </div>
              {pendingReconcile && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Cancel keeps your current meal selections. You can adjust your party and try
                  again.
                </p>
              )}
            </section>
          )}

          {/* STEP 2 — Meals & extras */}
          {state.step === "meals" && (
            <MealsStep state={state} meals={meals} onBack={backToSunday} onContinue={goToInfo} />
          )}

          {/* STEP 3 — Your information */}
          {state.step === "info" && (
            <InfoStep
              state={state}
              onFieldChange={setContactField}
              onBack={backToMeals}
              onContinue={goToReview}
            />
          )}

          {/* STEP 4 — Review & submit */}
          {state.step === "review" && (
            <ReviewStep
              state={state}
              catalog={meals.catalog}
              quote={meals.quote}
              quoteLoading={meals.quoteLoading}
              quoteError={meals.quoteError}
              onRetryQuote={meals.retryQuote}
              onBack={() => {
                if (!submission.controller.canEditOrBack()) return;
                // After a proven rejection, reset the controller so returning
                // to review builds a fresh payload + key from the (possibly
                // edited) wizard state instead of retrying the old rejected
                // payload. Never reset an uncertain request — that could
                // create a duplicate.
                if (submission.controller.phase === "rejected") {
                  submission.actions.resetForNewRequest();
                }
                setState((s) => ({ ...s, step: "info" as BookStep }));
              }}
              onEditStep={(step) => {
                if (!submission.controller.canEditOrBack()) return;
                if (submission.controller.phase === "rejected") {
                  submission.actions.resetForNewRequest();
                }
                setState((s) => ({ ...s, step: step as BookStep }));
              }}
              controller={submission.controller}
              phase={submission.phase}
              result={submission.controller.result}
              error={submission.controller.error}
              onStart={submission.actions.start}
              onRetry={submission.actions.retry}
              onResetForNewRequest={submission.actions.resetForNewRequest}
            />
          )}
        </div>

        {/* Sidebar */}
        <aside className="order-1 space-y-4 lg:order-2">
          <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">How requests work</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>You submit a request — your booking is not yet confirmed.</li>
              <li>Our team reviews availability and confirms your Sunday.</li>
              <li>We'll contact you about your deposit and final details.</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Good to know</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Guest limits are per-request ceilings, not remaining seats.</li>
              <li>Times are shown in the restaurant's local timezone.</li>
              <li>Large parties stay together in one request.</li>
            </ul>
          </div>
        </aside>
      </div>
    </Container>
  );
}

/** Accessible party counter with +/- buttons and a number input. */
function PartyCounter({
  label,
  value,
  onDecrement,
  onIncrement,
  onChange,
}: {
  label: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  onChange: (v: number) => void;
}) {
  const id = `party-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={onDecrement}
          disabled={value <= 0}
        >
          <Minus className="size-4" aria-hidden />
        </Button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-9 w-16 rounded-md border border-input bg-background text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={onIncrement}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// Re-export for tests that import the component module.
export {
  applyRefresh,
  findOption,
  groupOptionsBySunday,
  reconcileSelection,
  validateParty,
  totalGuests,
  formatServiceDate,
  formatSeatingTime,
  initialWizardState,
  BOOK_STEPS,
  STEP_LABELS,
};
export type { BookStep, BookWizardState, SundayGroup };
