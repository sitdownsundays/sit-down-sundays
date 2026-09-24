import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { FormField } from "@/components/layout/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/layout/button-link";
import { signUp } from "@/lib/auth.functions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/constants";

export const Route = createFileRoute("/_public/create-account")({
  head: () => ({
    meta: [
      { title: "Create Account — Sit Down Sundays" },
      {
        name: "description",
        content: "Create a Sit Down Sundays guest account to manage reservations and payments.",
      },
      { property: "og:title", content: "Create Account — Sit Down Sundays" },
      { property: "og:description", content: "Create a guest account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CreateAccountPage,
});

function CreateAccountPage() {
  const signUpFn = useServerFn(signUp);
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await signUpFn({
        data: { email, password, firstName, lastName },
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      if (res.kind === "validation") {
        setError(res.message ?? "Please check your details and try again.");
      } else {
        setError(res.message ?? "Account creation could not be completed.");
      }
    } catch {
      setError("Account creation could not be completed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Container size="narrow" className="py-12">
        <div className="rounded-2xl border border-success/30 bg-success/5 p-8 text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
          <h2 className="mt-4 font-display text-2xl font-bold text-foreground">Check your email</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            We've sent a verification link to your email. Please confirm your address to activate
            your account and sign in.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link to="/sign-in">Continue to sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/">Return home</Link>
            </Button>
          </div>
        </div>
      </Container>
    );
  }

  return (
    <Container size="narrow" className="py-12">
      <PageHeader
        eyebrow="Account"
        title="Create your account"
        description="Set up a guest account to join the table and manage your Sundays."
      />

      {error && (
        <div
          className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="First name"
            htmlFor="ca-firstName"
            required
            error={fieldErrors.firstName}
          >
            <Input
              id="ca-firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              required
            />
          </FormField>
          <FormField label="Last name" htmlFor="ca-lastName" required error={fieldErrors.lastName}>
            <Input
              id="ca-lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              required
            />
          </FormField>
        </div>
        <FormField label="Email" htmlFor="ca-email" required error={fieldErrors.email}>
          <Input
            id="ca-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </FormField>
        <FormField
          label="Password"
          htmlFor="ca-password"
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={fieldErrors.password}
        >
          <Input
            id="ca-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </FormField>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <ButtonLink to="/sign-in" variant="link">
          Sign in
        </ButtonLink>
      </p>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        New accounts receive Guest access only. By creating an account you agree to our provisional
        Terms and Privacy Policy.
      </p>
    </Container>
  );
}
