import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/layout/button-link";
import { cn } from "@/lib/utils";
import { useAuth, useSessionUser } from "@/lib/auth/auth-context";
import { signOut } from "@/lib/auth.functions";
import { primaryWorkspaceForRole } from "@/lib/auth/destinations";

export const BRAND_LOGO_SRC =
  "https://vibe.filesafe.space/1790115564962639543/attachments/92a30cb8-425c-4bd9-9ed4-8671866de6d2.png";

const NAV = [
  { label: "Home", to: "/" },
  { label: "Reserve", to: "/reserve" },
  { label: "The Experience", to: "/the-experience" },
  { label: "Menu", to: "/menu" },
  { label: "How It Works", to: "/how-it-works" },
  { label: "Private Room", to: "/private-room" },
  { label: "FAQ", to: "/faq" },
];

const SECONDARY = [
  { label: "Our Story", to: "/our-story" },
  { label: "Policies", to: "/policies" },
  { label: "Waitlist", to: "/waitlist" },
  { label: "Contact", to: "/contact" },
  { label: "Sign In", to: "/sign-in" },
];

export function PublicLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const signOutFn = useServerFn(signOut);
  const { session, refresh } = useAuth();
  const sessionUser = useSessionUser();
  const authenticated = session.authenticated;
  const primaryWorkspace =
    authenticated && sessionUser ? primaryWorkspaceForRole(sessionUser.roleKey) : null;

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
      {/* Announcement / reserve CTA */}
      <div className="bg-charcoal text-cream">
        <Container className="flex items-center justify-center gap-2 py-2 text-center text-sm">
          <span className="font-medium">Now accepting reservation requests.</span>
          <Link to="/reserve" className="underline underline-offset-2 hover:text-gold">
            Reserve →
          </Link>
        </Container>
      </div>

      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <Container className="flex h-[84px] items-center justify-between lg:h-[112px]">
          <Link
            to="/"
            className="group flex items-center focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-md"
            aria-label="Sit Down Sundays home"
          >
            <img
              src={BRAND_LOGO_SRC}
              alt="D.A.'s Banquets & Events"
              className="block h-12 w-auto max-w-[170px] object-contain sm:h-14 sm:max-w-[200px] lg:h-20 lg:max-w-[280px]"
              loading="eager"
            />
          </Link>

          <nav className="hidden items-center gap-1 xl:flex" aria-label="Primary">
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

          <div className="hidden items-center gap-2 xl:flex">
            {authenticated ? (
              <>
                {primaryWorkspace && (
                  <Link
                    to={primaryWorkspace.to as never}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    {primaryWorkspace.label}
                  </Link>
                )}
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
                <ButtonLink to="/reserve" size="default">
                  Reserve
                </ButtonLink>
              </>
            )}
          </div>

          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-accent xl:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </Container>

        {open && (
          <div className="border-t border-border bg-background xl:hidden">
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
                    {primaryWorkspace && (
                      <ButtonLink
                        to={primaryWorkspace.to as never}
                        variant="outline"
                        className="w-full"
                        onClick={() => setOpen(false)}
                      >
                        {primaryWorkspace.label}
                      </ButtonLink>
                    )}
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
                  <ButtonLink to="/reserve" className="w-full" onClick={() => setOpen(false)}>
                    Reserve
                  </ButtonLink>
                )}
              </div>
            </Container>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <PublicFooter />
    </div>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-border bg-muted/40">
      <Container className="grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Link to="/" className="group flex items-center gap-2.5">
            <img
              src={BRAND_LOGO_SRC}
              alt="D.A.'s Banquets & Events"
              className="h-10 w-auto max-w-[140px] object-contain"
              loading="lazy"
            />
            <div className="flex flex-col">
              <span className="font-display text-base font-bold text-foreground">
                Sit Down Sundays
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                D.A.&apos;s Banquets &amp; Events
              </span>
            </div>
          </Link>
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
