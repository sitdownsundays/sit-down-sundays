/**
 * Booking wizard Step 4 (Review & submit) — presentational component.
 *
 * Submission state, success state, and the idempotency lifecycle are owned by
 * the PARENT wizard's SubmissionController (see useSubmissionController), which
 * SURVIVES this component unmounting. If the user clicks Edit/Back while the
 * outcome is uncertain, the controller retains the exact key + payload; a
 * remounted review step reads the existing controller and cannot silently
 * generate a new key and submit a duplicate.
 *
 * Phases (from the controller):
 *  - idle:        no submission; a new request may start.
 *  - submitting:  in flight; Edit/Back/Submit all blocked.
 *  - uncertain:   network outcome unknown (request MAY be saved). Edit/Back
 *                  BLOCKED; only "Retry to check status" (same key + payload)
 *                  is allowed. A new/edited payload is NOT permitted until a
 *                  definitive response proves the previous request was not
 *                  saved.
 *  - rejected:    definitive failure (nothing saved). Edit/Back + new submit OK.
 *  - success:     saved. Resubmission blocked.
 *
 * This submits a REQUEST — not a confirmed reservation, payment, or guaranteed
 * table. No payment is collected in this phase.
 *
 * Client-safe; the controller + submit function are injected by the wizard.
 */
import { ArrowLeft, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/layout/button-link";
import { ErrorState } from "@/components/layout/error-state";
import {
  buildSubmissionPayload,
  formatCents,
  quoteIsSubmittable,
  menuItemName,
  addonName,
  packageName,
  platterName,
} from "@/lib/booking/submit-helpers";
import { validateContact } from "@/lib/booking/contact-rules";
import { formatServiceDate, formatSeatingTime, totalGuests } from "@/lib/booking/wizard-helpers";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";
import type { QuoteResult } from "@/lib/public-quote.functions";
import type { PublicOrderingCatalog } from "@/lib/booking/public-catalog";
import type {
  SubmitReservationRequestInput,
  SubmitReservationResult,
} from "@/lib/reservation/types";
import type { SubmissionController, SubmissionPhase } from "@/lib/booking/submission-controller";

interface Props {
  state: BookWizardState;
  catalog: PublicOrderingCatalog | null;
  quote: QuoteResult | null;
  quoteLoading: boolean;
  quoteError: string | null;
  onRetryQuote: () => void;
  onBack: () => void;
  onEditStep: (step: "sunday" | "meals" | "info") => void;
  controller: SubmissionController;
  phase: SubmissionPhase;
  result: SubmitReservationResult | null;
  error: string | null;
  onStart: (buildPayload: (key: string) => SubmitReservationRequestInput) => Promise<void>;
  onRetry: () => Promise<void>;
  /** Reset the controller for a new/edited request after a proven rejection. */
  onResetForNewRequest: () => void;
}

export function ReviewStep({
  state,
  catalog,
  quote,
  quoteLoading,
  quoteError,
  onRetryQuote,
  onBack,
  onEditStep,
  controller,
  phase,
  result,
  error,
  onStart,
  onRetry,
  onResetForNewRequest,
}: Props) {
  const contactValid = validateContact(state).valid;
  const submittable = quoteIsSubmittable(quote, quoteLoading) && contactValid;

  // Edit/Back are blocked while submitting OR uncertain (the request may be
  // saved server-side; navigating away must not discard the recovery path).
  const navBlocked = !controller.canEditOrBack();
  const submitting = phase === "submitting";
  const uncertain = phase === "uncertain";
  const rejected = phase === "rejected";
  // Secure key generation is only known to have failed when the controller
  // reached "rejected" WITHOUT ever calling submit (no payload). A fresh idle
  // request has key === null because start() generates the key — that must
  // NOT block submission.
  const keyGenFailed = rejected && controller.payload === null && controller.key === null;

  const handleSubmit = () => {
    if (submitting) return;
    if (uncertain) {
      // Retry the SAME key + payload to recover the original result.
      void onRetry();
      return;
    }
    if (rejected) {
      // After a proven rejection the user may have edited their selections.
      // If the controller still holds the old payload, retry it; if they
      // want to submit corrected data, resetForNewRequest is called first.
      if (controller.canRetry()) {
        void onRetry();
      }
      return;
    }
    // idle — start a NEW submission. start() generates the key securely.
    if (!submittable) return;
    if (!controller.canStartNew()) return;
    void onStart((key) => {
      const previewSubtotal = quote?.ok ? quote.subtotalCents : undefined;
      return buildSubmissionPayload(state, key, previewSubtotal);
    });
  };

  // ---- Success screen ----
  if (controller.isComplete() && result?.success && result.reservationNumber) {
    return (
      <section aria-labelledby="step-review-heading">
        <h2 id="step-review-heading" className="font-display text-xl font-semibold text-foreground">
          4. Review request
        </h2>
        <div className="mt-6 rounded-lg border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-6 text-primary" aria-hidden />
            <div>
              <p className="font-display text-lg font-semibold text-foreground">
                Reservation request received
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your booking is <strong>not yet confirmed</strong>. Our team will review
                availability and contact you about your deposit and final details.
              </p>
              <p className="mt-3 text-sm">
                <span className="text-muted-foreground">Your request number:</span>{" "}
                <span className="font-mono font-medium text-foreground">
                  {result.reservationNumber}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Status: Pending review · Unpaid — no payment has been collected.
              </p>
            </div>
          </div>
          <div className="mt-6">
            <ButtonLink to="/" variant="outline">
              <ArrowLeft className="size-4" aria-hidden />
              Back to website
            </ButtonLink>
          </div>
        </div>
      </section>
    );
  }

  // Configured restaurant timezone — do NOT silently default to America/Chicago.
  const tz = state.selectedOption?.restaurantTimezone;
  const tzMissing = !tz || tz.trim() === "";
  const guests = totalGuests(state);

  const submitLabel = uncertain
    ? "Retry to check request status"
    : submitting
      ? "Submitting…"
      : "Submit reservation request";

  const submitDisabled =
    submitting ||
    keyGenFailed ||
    (phase === "idle" && !submittable) ||
    (phase === "uncertain" && !controller.canRetry()) ||
    (phase === "rejected" && !controller.canRetry() && !submittable);

  return (
    <section aria-labelledby="step-review-heading">
      <h2 id="step-review-heading" className="font-display text-xl font-semibold text-foreground">
        4. Review request
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Review the details below and submit your request. No payment is collected at this stage.
      </p>

      {/* Uncertain-outcome notice */}
      {uncertain && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-foreground"
        >
          {error}
        </div>
      )}

      {/* Secure key generation unavailable */}
      {keyGenFailed && (
        <div className="mt-4">
          <ErrorState
            title="Cannot start submission"
            message="Secure request generation is unavailable in this browser. Please use a modern browser and try again."
          />
        </div>
      )}

      {/* Missing configured timezone */}
      {!keyGenFailed && tzMissing && phase !== "success" && (
        <div className="mt-4">
          <ErrorState
            title="Missing restaurant timezone"
            message="The restaurant timezone hasn't been configured yet. Our team needs to set it before requests can be submitted. Please contact us directly."
          />
        </div>
      )}

      {!keyGenFailed && !tzMissing && (
        <div className="mt-6 space-y-6">
          {/* Sunday & party */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-foreground">
                Sunday &amp; party
              </h3>
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                onClick={() => onEditStep("sunday")}
                disabled={navBlocked}
              >
                Edit
              </button>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Date</dt>
                <dd className="font-medium text-foreground">
                  {state.selectedOption
                    ? formatServiceDate(state.selectedOption.sundayService.date, tz)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Seating</dt>
                <dd className="font-medium text-foreground">
                  {state.selectedOption
                    ? `${formatSeatingTime(state.selectedOption.seatingTime.startTime)} – ${formatSeatingTime(state.selectedOption.seatingTime.endTime)}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Timezone</dt>
                <dd className="font-medium text-foreground">{tz}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Party</dt>
                <dd className="font-medium text-foreground">
                  {guests} guests ({state.adults} adults, {state.seniors} seniors, {state.children}{" "}
                  children)
                </dd>
              </div>
            </dl>
          </div>

          {/* Meals */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-foreground">
                Meals &amp; extras
              </h3>
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                onClick={() => onEditStep("meals")}
                disabled={navBlocked}
              >
                Edit
              </button>
            </div>
            <ul className="mt-3 space-y-3 text-sm">
              {state.meals.allocations.map((g) => (
                <li key={g.guestId} className="rounded-md border border-border bg-background p-3">
                  <p className="font-medium text-foreground">
                    Guest {g.guestIndex + 1}
                    {g.name && g.name !== `Guest ${g.guestIndex + 1}` ? ` — ${g.name}` : ""}{" "}
                    <span className="text-muted-foreground">({g.category})</span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Package: {packageName(catalog, g.packageId ?? "")}
                  </p>
                  {g.included.length > 0 && (
                    <p className="mt-0.5 text-muted-foreground">
                      Selections:{" "}
                      {g.included
                        .map(
                          (s) => `${menuItemName(catalog, s.menuItemId)} (${s.selectionCategory})`,
                        )
                        .join(", ")}
                    </p>
                  )}
                  {g.addons.length > 0 && (
                    <p className="mt-0.5 text-muted-foreground">
                      Add-ons:{" "}
                      {g.addons
                        .map((a) => `${addonName(catalog, a.addonId)} ×${a.quantity}`)
                        .join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {state.meals.platters.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-foreground">Shared platters</p>
                <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                  {state.meals.platters.map((p) => (
                    <li key={p.platterId}>
                      {platterName(catalog, p.platterId)} ×{p.quantity}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Contact */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-foreground">
                Your information
              </h3>
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                onClick={() => onEditStep("info")}
                disabled={navBlocked}
              >
                Edit
              </button>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium text-foreground">
                  {state.contact.contactFirstName} {state.contact.contactLastName}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium text-foreground">{state.contact.contactEmail}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-medium text-foreground">{state.contact.contactPhone}</dd>
              </div>
              {state.contact.occasion && (
                <div>
                  <dt className="text-muted-foreground">Occasion</dt>
                  <dd className="font-medium text-foreground">{state.contact.occasion}</dd>
                </div>
              )}
            </dl>
            {(state.contact.dietaryNotes ||
              state.contact.accessibilityRequests ||
              state.contact.guestNotes) && (
              <div className="mt-3 space-y-1 text-sm">
                {state.contact.dietaryNotes && (
                  <p>
                    <span className="text-muted-foreground">Dietary notes:</span>{" "}
                    {state.contact.dietaryNotes}
                  </p>
                )}
                {state.contact.accessibilityRequests && (
                  <p>
                    <span className="text-muted-foreground">Accessibility:</span>{" "}
                    {state.contact.accessibilityRequests}
                  </p>
                )}
                {state.contact.guestNotes && (
                  <p>
                    <span className="text-muted-foreground">Requests:</span>{" "}
                    {state.contact.guestNotes}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Pricing estimate */}
          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-display text-lg font-semibold text-foreground">Pricing estimate</h3>
            {quoteLoading && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Calculating your estimate…
              </p>
            )}
            {!quoteLoading && quoteError && (
              <div className="mt-3">
                <ErrorState
                  title="Couldn't calculate estimate"
                  message={quoteError}
                  action={
                    <Button variant="outline" onClick={onRetryQuote} disabled={navBlocked}>
                      Try again
                    </Button>
                  }
                />
              </div>
            )}
            {!quoteLoading && !quoteError && quote && !quote.ok && (
              <div className="mt-3">
                <ErrorState
                  title="Couldn't calculate estimate"
                  message={quote.error ?? "Please try again."}
                  action={
                    <Button variant="outline" onClick={onRetryQuote} disabled={navBlocked}>
                      Try again
                    </Button>
                  }
                />
              </div>
            )}
            {!quoteLoading && quote?.ok && (
              <dl className="mt-3 space-y-2 text-sm">
                {quote.subtotalCents !== undefined && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="font-medium text-foreground">
                      {formatCents(quote.subtotalCents)}
                    </dd>
                  </div>
                )}
                {quote.grandTotalCents !== undefined && (
                  <div className="flex justify-between border-t border-border pt-2">
                    <dt className="font-medium text-foreground">Total</dt>
                    <dd className="font-semibold text-foreground">
                      {formatCents(quote.grandTotalCents)}
                    </dd>
                  </div>
                )}
                {quote.depositRequiredCents !== undefined && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Required deposit (not yet paid)</dt>
                    <dd className="text-foreground">{formatCents(quote.depositRequiredCents)}</dd>
                  </div>
                )}
                {quote.remainingBalanceCents !== undefined && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Outstanding balance</dt>
                    <dd className="font-medium text-foreground">
                      {formatCents(quote.remainingBalanceCents)}
                    </dd>
                  </div>
                )}
                {quote.hasUnresolvedRules && quote.unresolvedNotes && (
                  <p role="alert" className="text-destructive">
                    Unresolved pricing: {quote.unresolvedNotes.join(", ")}
                  </p>
                )}
              </dl>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" aria-hidden />
              Estimate only — final pricing is confirmed at submission. No payment is collected at
              this stage.
            </p>
          </div>

          {/* Submit error (definitive rejection) */}
          {error && rejected && (
            <div className="space-y-3">
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    // Reset for a corrected/new request. Only permitted after a
                    // proven rejection (the server confirmed nothing was saved).
                    onResetForNewRequest();
                  }}
                >
                  Submit a corrected request
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void onRetry()}
                  disabled={!controller.canRetry()}
                >
                  Retry the same request
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Editing your selections and submitting a corrected request is safe — the previous
                request was not saved.
              </p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={navBlocked}
              title={navBlocked ? "Submission in progress…" : "Back to your information"}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back to your information
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Step 4 of 4</span>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitDisabled}
                title={
                  keyGenFailed
                    ? "Secure request generation unavailable"
                    : uncertain
                      ? "Retry to check whether your request was saved"
                      : !submittable && phase === "idle"
                        ? "Complete all steps and resolve pricing to submit"
                        : submitting
                          ? "Submitting…"
                          : "Submit your reservation request"
                }
              >
                {submitting || uncertain ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> {submitLabel}
                  </>
                ) : (
                  submitLabel
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
