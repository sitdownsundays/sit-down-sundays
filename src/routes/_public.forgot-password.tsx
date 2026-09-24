import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { FormField } from "@/components/layout/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { forgotPassword } from "@/lib/auth.functions";

export const Route = createFileRoute("/_public/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot Password — Sit Down Sundays" },
      { name: "description", content: "Reset your Sit Down Sundays account password." },
      { property: "og:title", content: "Forgot Password — Sit Down Sundays" },
      { property: "og:description", content: "Reset your account password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const forgotFn = useServerFn(forgotPassword);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await forgotFn({ data: { email } });
      setDone(true);
    } catch {
      // Neutral success regardless.
      setDone(true);
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
            If an account exists for that email, we've sent a password reset link. The link will
            expire shortly.
          </p>
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link to="/sign-in">Back to sign in</Link>
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
        title="Forgot your password"
        description="Enter your email and we'll send you a link to reset your password."
      />
      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
        <FormField label="Email" htmlFor="fp-email" required>
          <Input
            id="fp-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </FormField>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Sending…
            </>
          ) : (
            "Send reset link"
          )}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/sign-in" className="font-medium hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </Container>
  );
}
