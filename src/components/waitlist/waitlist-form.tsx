import { useState, useRef, useEffect, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import {
  submitWaitlist,
  getWaitlistPublicConfig,
  getWaitlistConsentText,
} from "@/lib/waitlist.functions";
import { SMS_CONSENT_TEXT, PARTY_MIN, PARTY_MAX } from "@/lib/waitlist/constants";
import type { WaitlistSubmitResult } from "@/lib/waitlist/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/layout/form-field";

interface FieldErrors {
  [key: string]: string;
}

interface WaitlistFormProps {
  /** Children rendered above the submit button (e.g. consent blocks). */
  children?: ReactNode;
}

export function WaitlistForm({ children }: WaitlistFormProps) {
  const submit = useServerFn(submitWaitlist);
  const getConfig = useServerFn(getWaitlistPublicConfig);
  const getConsent = useServerFn(getWaitlistConsentText);

  const [values, setValues] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    partySize: "",
    preferredDate: "",
    preferredSeatingTime: "",
    privateRoomInterest: false,
    emailMarketingConsent: false,
    smsConsent: false,
    // honeypot
    website: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WaitlistSubmitResult | null>(null);
  const [dataMode, setDataMode] = useState<"mock" | "supabase">("supabase");
  const [smsText, setSmsText] = useState(SMS_CONSENT_TEXT);

  const firstErrorRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const liveRegionRef = useRef<HTMLDivElement | null>(null);

  // Load public config + consent text once.
  useEffect(() => {
    void getConfig().then((c) => setDataMode(c.dataMode));
    void getConsent().then((c) => setSmsText(c.smsConsentText));
  }, [getConfig, getConsent]);

  // Focus the first invalid field after a validation failure.
  useEffect(() => {
    if (result?.ok === false && result.kind === "validation" && firstErrorRef.current) {
      firstErrorRef.current.focus();
    }
  }, [result]);

  function update<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrors({});
    setResult(null);

    const payload = {
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      phone: values.phone,
      partySize: Number(values.partySize),
      preferredDate: values.preferredDate || null,
      preferredSeatingTime: values.preferredSeatingTime || null,
      privateRoomInterest: values.privateRoomInterest,
      emailMarketingConsent: values.emailMarketingConsent,
      smsConsent: values.smsConsent,
      website: values.website,
      source: "public_waitlist",
    };

    try {
      const res = await submit({ data: payload });
      setResult(res);
      if (res.ok) {
        // Reset on success; do not reveal submitted email/phone.
        setValues({
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          partySize: "",
          preferredDate: "",
          preferredSeatingTime: "",
          privateRoomInterest: false,
          emailMarketingConsent: false,
          smsConsent: false,
          website: "",
        });
      }
    } catch {
      setResult({ ok: false, kind: "unexpected" });
    } finally {
      setSubmitting(false);
    }
  }

  // --- Success state -------------------------------------------------------
  if (result?.ok) {
    return (
      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-success/30 bg-success/5 p-8 text-center"
      >
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <h2 className="mt-4 font-display text-2xl font-bold text-foreground">You're on the list</h2>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Thank you for your interest in Sit Down Sundays. Joining the waitlist is not a confirmed
          reservation. We'll share booking invitations and availability with you when the time
          comes.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link to="/the-experience">Explore the Experience</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/menu">View the Menu</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/">Return Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  const fieldError = (key: string): string | undefined => {
    if (result?.ok === false && result.kind === "validation") return result.errors[key];
    return errors[key];
  };
  const assignRef = (key: string) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    if (fieldError(key) && !firstErrorRef.current) firstErrorRef.current = el;
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5" aria-describedby="wl-status">
      {/* Accessible live region for result messages */}
      <div id="wl-status" ref={liveRegionRef} role="status" aria-live="polite" className="sr-only">
        {result?.ok === false
          ? result.kind === "validation"
            ? "Please correct the highlighted fields."
            : "Something went wrong. Please try again."
          : ""}
      </div>

      {/* Mock-mode indicator (development only) */}
      {dataMode === "mock" && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground">
          Development mock mode — submissions are not persisted to a live database.
        </p>
      )}

      {/* Unexpected error */}
      {result?.ok === false && result.kind === "unexpected" && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>Something went wrong while submitting. Please try again in a moment.</p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="First name"
          htmlFor="wl-firstName"
          required
          error={fieldError("firstName")}
        >
          <Input
            id="wl-firstName"
            ref={assignRef("firstName")}
            value={values.firstName}
            onChange={(e) => update("firstName", e.target.value)}
            autoComplete="given-name"
            required
          />
        </FormField>
        <FormField label="Last name" htmlFor="wl-lastName" required error={fieldError("lastName")}>
          <Input
            id="wl-lastName"
            ref={assignRef("lastName")}
            value={values.lastName}
            onChange={(e) => update("lastName", e.target.value)}
            autoComplete="family-name"
            required
          />
        </FormField>
      </div>

      <FormField label="Email address" htmlFor="wl-email" required error={fieldError("email")}>
        <Input
          id="wl-email"
          ref={assignRef("email")}
          type="email"
          value={values.email}
          onChange={(e) => update("email", e.target.value)}
          autoComplete="email"
          required
        />
      </FormField>

      <FormField
        label="Mobile phone number"
        htmlFor="wl-phone"
        required
        error={fieldError("phone")}
      >
        <Input
          id="wl-phone"
          ref={assignRef("phone")}
          type="tel"
          value={values.phone}
          onChange={(e) => update("phone", e.target.value)}
          autoComplete="tel"
          required
        />
      </FormField>

      <FormField
        label={`Expected party size (${PARTY_MIN}–${PARTY_MAX})`}
        htmlFor="wl-partySize"
        required
        error={fieldError("partySize")}
      >
        <Input
          id="wl-partySize"
          ref={assignRef("partySize")}
          type="number"
          min={PARTY_MIN}
          max={PARTY_MAX}
          value={values.partySize}
          onChange={(e) => update("partySize", e.target.value)}
          required
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Preferred Sunday (optional)"
          htmlFor="wl-preferredDate"
          error={fieldError("preferredDate")}
        >
          <Input
            id="wl-preferredDate"
            ref={assignRef("preferredDate")}
            type="date"
            value={values.preferredDate}
            onChange={(e) => update("preferredDate", e.target.value)}
          />
        </FormField>
        <FormField
          label="Preferred seating time (optional)"
          htmlFor="wl-preferredSeatingTime"
          error={fieldError("preferredSeatingTime")}
        >
          <Input
            id="wl-preferredSeatingTime"
            ref={assignRef("preferredSeatingTime")}
            value={values.preferredSeatingTime}
            onChange={(e) => update("preferredSeatingTime", e.target.value)}
            placeholder="e.g. Early afternoon"
          />
        </FormField>
      </div>

      {/* Private room interest */}
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <Checkbox
          id="wl-privateRoom"
          checked={values.privateRoomInterest}
          onCheckedChange={(c) => update("privateRoomInterest", c === true)}
        />
        <Label htmlFor="wl-privateRoom" className="cursor-pointer text-sm font-normal">
          I'm interested in a private room for my gathering.
        </Label>
      </div>

      {/* Consent block */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Checkbox
            id="wl-emailConsent"
            checked={values.emailMarketingConsent}
            onCheckedChange={(c) => update("emailMarketingConsent", c === true)}
          />
          <Label htmlFor="wl-emailConsent" className="cursor-pointer text-sm font-normal">
            Send me occasional updates and invitations by email. (Optional — not required to join
            the waitlist.)
          </Label>
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <Checkbox
              id="wl-smsConsent"
              checked={values.smsConsent}
              onCheckedChange={(c) => update("smsConsent", c === true)}
            />
            <Label htmlFor="wl-smsConsent" className="cursor-pointer text-sm font-normal">
              I agree to receive text messages. (Optional — not required to join the waitlist.)
            </Label>
          </div>
          <p className="ml-7 text-xs leading-relaxed text-muted-foreground">{smsText}</p>
        </div>
      </div>

      {children}

      {/* Honeypot — visually hidden, must remain empty */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="wl-website">Website</label>
        <input
          id="wl-website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => update("website", e.target.value)}
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Joining…
          </>
        ) : (
          "Join the waitlist"
        )}
      </Button>

      <p className={cn("text-xs text-muted-foreground")}>
        By joining, you acknowledge our provisional Terms and Privacy Policy. Final policy language
        will be shared before booking opens.
      </p>
    </form>
  );
}
