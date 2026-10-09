/**
 * Booking wizard Step 3 (Your information) — presentational component.
 *
 * Collects contact details and optional dietary/accessibility/occasion
 * requests. Validation reuses the shared client-safe rules in
 * src/lib/booking/contact-rules.ts (which mirror the authoritative server
 * schema). Client-safe.
 */
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/layout/button-link";
import { FormField } from "@/components/layout/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTACT_LIMITS,
  validateContact,
  type ContactFieldErrors,
} from "@/lib/booking/contact-rules";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";

interface Props {
  state: BookWizardState;
  onFieldChange: (field: keyof BookWizardState["contact"], value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function InfoStep({ state, onFieldChange, onBack, onContinue }: Props) {
  const { errors, valid } = validateContact(state);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  // Focus the error summary on mount when there are errors (after a failed
  // continue attempt). The parent controls when to show errors via a
  // `showErrors` flag passed through state; here we always compute errors but
  // only surface them once the user has attempted to continue. We approximate
  // that by focusing the summary only when it exists and has content.
  useEffect(() => {
    if (errorSummaryRef.current && errorSummaryRef.current.hasChildNodes()) {
      errorSummaryRef.current.focus();
    }
  }, [valid]);

  const fieldProps = (field: keyof ContactFieldErrors, id: string) => ({
    id,
    "aria-invalid": Boolean(errors[field]) || undefined,
    "aria-describedby": errors[field] ? `${id}-error` : undefined,
  });

  return (
    <section aria-labelledby="step-info-heading">
      <h2 id="step-info-heading" className="font-display text-xl font-semibold text-foreground">
        3. Your information
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell us how to reach you about your reservation request. This does not create an account,
        and no payment is collected yet.
      </p>

      <div className="mt-6 space-y-6">
        {/* Contact details */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="font-display text-lg font-semibold text-foreground">Contact details</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField
              label="First name"
              htmlFor="contact-first-name"
              required
              error={errors.contactFirstName}
            >
              <Input
                id="contact-first-name"
                type="text"
                autoComplete="given-name"
                maxLength={CONTACT_LIMITS.firstNameMax}
                value={state.contact.contactFirstName}
                onChange={(e) => onFieldChange("contactFirstName", e.target.value)}
                {...fieldProps("contactFirstName", "contact-first-name")}
              />
              {errors.contactFirstName && (
                <p id="contact-first-name-error" className="sr-only">
                  {errors.contactFirstName}
                </p>
              )}
            </FormField>
            <FormField
              label="Last name"
              htmlFor="contact-last-name"
              required
              error={errors.contactLastName}
            >
              <Input
                id="contact-last-name"
                type="text"
                autoComplete="family-name"
                maxLength={CONTACT_LIMITS.lastNameMax}
                value={state.contact.contactLastName}
                onChange={(e) => onFieldChange("contactLastName", e.target.value)}
                {...fieldProps("contactLastName", "contact-last-name")}
              />
              {errors.contactLastName && (
                <p id="contact-last-name-error" className="sr-only">
                  {errors.contactLastName}
                </p>
              )}
            </FormField>
            <FormField
              label="Email address"
              htmlFor="contact-email"
              required
              error={errors.contactEmail}
            >
              <Input
                id="contact-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={CONTACT_LIMITS.emailMax}
                value={state.contact.contactEmail}
                onChange={(e) => onFieldChange("contactEmail", e.target.value)}
                {...fieldProps("contactEmail", "contact-email")}
              />
              {errors.contactEmail && (
                <p id="contact-email-error" className="sr-only">
                  {errors.contactEmail}
                </p>
              )}
            </FormField>
            <FormField
              label="Phone number"
              htmlFor="contact-phone"
              required
              error={errors.contactPhone}
            >
              <Input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={CONTACT_LIMITS.phoneMax}
                value={state.contact.contactPhone}
                onChange={(e) => onFieldChange("contactPhone", e.target.value)}
                {...fieldProps("contactPhone", "contact-phone")}
              />
              {errors.contactPhone && (
                <p id="contact-phone-error" className="sr-only">
                  {errors.contactPhone}
                </p>
              )}
            </FormField>
          </div>
        </div>

        {/* Optional requests */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Requests <span className="text-sm font-normal text-muted-foreground">(optional)</span>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            A request note is not a guarantee that an allergy can be accommodated. Our team will
            follow up if we need more details.
          </p>
          <div className="mt-4 space-y-4">
            <FormField
              label="Dietary notes / allergies"
              htmlFor="dietary-notes"
              error={errors.dietaryNotes}
              hint={`Up to ${CONTACT_LIMITS.notesMax} characters`}
            >
              <Textarea
                id="dietary-notes"
                rows={3}
                maxLength={CONTACT_LIMITS.notesMax}
                value={state.contact.dietaryNotes}
                onChange={(e) => onFieldChange("dietaryNotes", e.target.value)}
                {...fieldProps("dietaryNotes", "dietary-notes")}
              />
            </FormField>
            <FormField
              label="Accessibility requests"
              htmlFor="accessibility-requests"
              error={errors.accessibilityRequests}
              hint={`Up to ${CONTACT_LIMITS.notesMax} characters`}
            >
              <Textarea
                id="accessibility-requests"
                rows={3}
                maxLength={CONTACT_LIMITS.notesMax}
                value={state.contact.accessibilityRequests}
                onChange={(e) => onFieldChange("accessibilityRequests", e.target.value)}
                {...fieldProps("accessibilityRequests", "accessibility-requests")}
              />
            </FormField>
            <FormField
              label="Occasion"
              htmlFor="occasion"
              error={errors.occasion}
              hint={`Up to ${CONTACT_LIMITS.occasionMax} characters`}
            >
              <Input
                id="occasion"
                type="text"
                maxLength={CONTACT_LIMITS.occasionMax}
                value={state.contact.occasion}
                onChange={(e) => onFieldChange("occasion", e.target.value)}
                {...fieldProps("occasion", "occasion")}
              />
            </FormField>
            <FormField
              label="General requests"
              htmlFor="guest-notes"
              error={errors.guestNotes}
              hint={`Up to ${CONTACT_LIMITS.notesMax} characters`}
            >
              <Textarea
                id="guest-notes"
                rows={3}
                maxLength={CONTACT_LIMITS.notesMax}
                value={state.contact.guestNotes}
                onChange={(e) => onFieldChange("guestNotes", e.target.value)}
                {...fieldProps("guestNotes", "guest-notes")}
              />
            </FormField>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Step 3 of 4</span>
            <Button
              type="button"
              onClick={onContinue}
              disabled={!valid}
              title={valid ? "Continue to review" : "Complete the required fields to continue"}
            >
              Continue
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" aria-hidden />
          No payment is collected at this stage. You'll review your request before submitting.
        </p>

        <div>
          <ButtonLink to="/" variant="ghost">
            <ArrowLeft className="size-4" aria-hidden />
            Back to website
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
