import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { FormField } from "@/components/layout/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/auth.functions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/constants";

export const Route = createFileRoute("/_public/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — Sit Down Sundays" },
      { name: "description", content: "Set a new password for your Sit Down Sundays account." },
      { property: "og:title", content: "Reset Password — Sit Down Sundays" },
      { property: "og:description", content: "Set a new account password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const resetFn = useServerFn(resetPassword);
  const search = useSearch({ strict: false }) as {
    access_token?: string;
    code?: string;
  };

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await resetFn({
        data: {
          newPassword: password,
          accessToken: search.access_token,
          code: search.code,
        },
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      setError(res.message ?? "Reset link is invalid or expired.");
    } catch {
      setError("Password reset could not be completed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Container size="narrow" className="py-12">
        <div className="rounded-2xl border border-success/30 bg-success/5 p-8 text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
          <h2 className="mt-4 font-display text-2xl font-bold text-foreground">Password updated</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Your password has been changed. You can now sign in with your new password.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link to="/sign-in">Sign in</Link>
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
        title="Set a new password"
        description="Choose a new password for your account."
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
        <FormField
          label="New password"
          htmlFor="rp-password"
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          <Input
            id="rp-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </FormField>
        <FormField label="Confirm new password" htmlFor="rp-confirm" required>
          <Input
            id="rp-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </FormField>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Updating…
            </>
          ) : (
            "Update password"
          )}
        </Button>
      </form>
    </Container>
  );
}
