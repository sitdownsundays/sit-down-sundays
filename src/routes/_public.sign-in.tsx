import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, AlertCircle } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { FormField } from "@/components/layout/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/layout/button-link";
import { signIn } from "@/lib/auth.functions";
import { useAuth } from "@/lib/auth/auth-context";
import { sanitizeReturnPath, DEFAULT_POST_SIGNIN_PATH } from "@/lib/auth/constants";

export const Route = createFileRoute("/_public/sign-in")({
  head: () => ({
    meta: [
      { title: "Sign In — Sit Down Sundays" },
      { name: "description", content: "Sign in to your Sit Down Sundays guest account." },
      { property: "og:title", content: "Sign In — Sit Down Sundays" },
      { property: "og:description", content: "Sign in to your guest account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignInPage,
});

function SignInPage() {
  const signInFn = useServerFn(signIn);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    redirect?: string;
    blocked?: string;
  };

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<boolean>(search.blocked === "true");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setBlocked(false);

    try {
      const res = await signInFn({
        data: { email, password, returnTo: search.redirect },
      });
      if (res.ok) {
        await refresh();
        navigate({ to: res.redirectTo ?? DEFAULT_POST_SIGNIN_PATH });
        return;
      }
      if (res.kind === "unauthorized" && /verify your email/i.test(res.message ?? "")) {
        setError(res.message ?? "Please verify your email before signing in.");
      } else {
        setError(res.message ?? "Invalid email or password.");
      }
    } catch {
      setError("Sign-in could not be completed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="narrow" className="py-12">
      <PageHeader
        eyebrow="Account"
        title="Sign in"
        description="Welcome back. Sign in to manage your Sundays."
      />

      {blocked && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>Your account is not available. Please contact us if you believe this is an error.</p>
        </div>
      )}

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
        <FormField label="Email" htmlFor="si-email" required>
          <Input
            id="si-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </FormField>
        <FormField label="Password" htmlFor="si-password" required>
          <Input
            id="si-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </FormField>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <div className="mt-6 flex flex-col gap-2 text-center text-sm">
        <Link
          to="/forgot-password"
          className="font-medium text-muted-foreground hover:text-foreground"
        >
          Forgot your password?
        </Link>
        <p className="text-muted-foreground">
          New here?{" "}
          <ButtonLink to="/create-account" variant="link">
            Create an account
          </ButtonLink>
        </p>
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        By signing in you agree to our provisional Terms and Privacy Policy.
      </p>
    </Container>
  );
}

// Keep sanitizeReturnPath imported for test visibility of the guard surface.
export { sanitizeReturnPath };
