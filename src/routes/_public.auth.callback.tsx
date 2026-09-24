import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, AlertCircle } from "lucide-react";
import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/layout/button-link";
import { handleAuthCallback } from "@/lib/auth.functions";
import { useAuth } from "@/lib/auth/auth-context";

export const Route = createFileRoute("/_public/auth/callback")({
  head: () => ({
    meta: [
      { title: "Verifying — Sit Down Sundays" },
      { name: "description", content: "Verifying your email." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const exchange = useServerFn(handleAuthCallback);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    code?: string;
    error?: string;
    error_description?: string;
  };

  const ranRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState<string>("Verifying your email…");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (search.error) {
      setStatus("error");
      setMessage(
        search.error_description || search.error || "Verification could not be completed.",
      );
      return;
    }

    if (!search.code) {
      setStatus("error");
      setMessage("Verification link is missing required information.");
      return;
    }

    void (async () => {
      try {
        // The PKCE code_verifier is stored in an HttpOnly cookie by
        // @supabase/ssr during signup/recovery. The server-side SSR client
        // reads it automatically via the cookie adapter, so we only pass the
        // authorization code from the email redirect.
        const res = await exchange({ data: { authCode: search.code } });
        if (res.ok) {
          await refresh();
          navigate({ to: res.redirectTo ?? "/account" });
          return;
        }
        setStatus("error");
        setMessage(res.message ?? "Verification could not be completed.");
      } catch {
        setStatus("error");
        setMessage("Verification could not be completed.");
      }
    })();
  }, [exchange, refresh, navigate, search]);

  return (
    <Container
      size="narrow"
      className="flex min-h-[60vh] flex-col items-center justify-center py-12"
    >
      {status === "loading" ? (
        <div className="text-center">
          <Loader2 className="mx-auto size-10 animate-spin text-clay" aria-hidden />
          <p className="mt-4 text-muted-foreground">{message}</p>
        </div>
      ) : (
        <div className="max-w-md text-center">
          <AlertCircle className="mx-auto size-10 text-destructive" aria-hidden />
          <h1 className="mt-4 font-display text-xl font-bold text-foreground">
            Verification issue
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <ButtonLink to="/sign-in">Go to sign in</ButtonLink>
            <ButtonLink to="/" variant="outline">
              Return home
            </ButtonLink>
          </div>
        </div>
      )}
    </Container>
  );
}
