import { Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/layout/button-link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { signOut } from "@/lib/auth.functions";

const NAV = [
  { label: "Home", to: "/" },
  { label: "The Experience", to: "/the-experience" },
  { label: "Menu", to: "/menu" },
  { label: "How It Works", to: "/how-it-works" },
  { label: "Private Room", to: "/private-room" },
  { label: "FAQ", to: "/faq" },
];

const SECONDARY = [
  { label: "Our Story", to: "/our-story" },
  { label: "Policies", to: "/policies" },
  { label: "Contact", to: "/contact" },
  { label: "Sign In", to: "/sign-in" },
];

export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const signOutFn = useServerFn(signOut);
  const { session, refresh } = useAuth();
  const authenticated = session.authenticated;

  async function handleSignOut() {
    try {
      await signOutFn();
      await refresh();
    } finally {
      navigate({ to: "/" });
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Announcement / waitlist CTA */}
      <div className="bg-charcoal text-cream">
        <Container className="flex items-center justify-center gap-2 py-2 text-center text-sm">
          <span className="font-medium">Reservations opening soon.</span>
          <Link to="/waitlist" className="underline underline-offset-2 hover:text-gold">
            Join the waitlist →
          </Link>
        </Container>
      </div>

      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <Container className="flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2" aria-label="Sit Down Sundays home">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-clay text-cream font-display text-lg font-bold">
              S
            </span>
            <span className="font-display text-lg font-bold text-foreground">Sit Down Sundays</span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to as never}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
                  pathname === item.to ? "text-clay" : "text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            {authenticated ? (
              <>
                <Link
                  to="/account"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  My Account
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/sign-in"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Sign In
                </Link>
                <ButtonLink to="/waitlist" size="default">
                  Join the Waitlist
                </ButtonLink>
              </>
            )}
          </div>

          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-accent lg:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </Container>

        {open && (
          <div className="border-t border-border bg-background lg:hidden">
            <Container className="space-y-1 py-4">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to as never}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-2 text-base font-medium text-foreground hover:bg-accent"
                >
                  {item.label}
                </Link>
              ))}
              <div className="my-2 border-t border-border" />
              {SECONDARY.map((item) => (
                <Link
                  key={item.to}
                  to={item.to as never}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                >
                  {item.label}
                </Link>
              ))}
              <div className="pt-2">
                {authenticated ? (
                  <div className="space-y-2">
                    <ButtonLink to="/account" className="w-full" onClick={() => setOpen(false)}>
                      My Account
                    </ButtonLink>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        void handleSignOut();
                      }}
                      className="w-full rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <ButtonLink to="/waitlist" className="w-full" onClick={() => setOpen(false)}>
                    Join the Waitlist
                  </ButtonLink>
                )}
              </div>
            </Container>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <PublicFooter />
    </div>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-border bg-muted/40">
      <Container className="grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-clay text-cream font-display font-bold">
              S
            </span>
            <span className="font-display text-base font-bold text-foreground">
              Sit Down Sundays
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            A curated Sunday dining experience. Provisional content — final details coming soon.
          </p>
        </div>
        <FooterCol title="Explore" links={[...NAV, { label: "Our Story", to: "/our-story" }]} />
        <FooterCol title="Visit" links={SECONDARY} />
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Policies</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>
              <Link to="/policies" className="hover:text-foreground">
                Policies
              </Link>
            </li>
            <li>
              <Link to="/faq" className="hover:text-foreground">
                FAQ
              </Link>
            </li>
            <li>
              <Link to="/contact" className="hover:text-foreground">
                Contact
              </Link>
            </li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-border">
        <Container className="py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Sit Down Sundays. Provisional site.
        </Container>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; to: string }[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {links.map((l) => (
          <li key={l.to + l.label}>
            <Link to={l.to as never} className="hover:text-foreground">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
