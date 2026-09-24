import { Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu, X, Bell, LogOut } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Container } from "@/components/layout/container";
import { cn } from "@/lib/utils";
import { useMockRoleContext } from "@/lib/mock/mock-role-context";
import { useAuth, useSessionUser } from "@/lib/auth/auth-context";
import { signOut } from "@/lib/auth.functions";
import { ROLE_LABELS } from "@/lib/domain/roles";
import { ROLE_KEYS } from "@/lib/domain";
import { AREA_NAV, filterNavByRole, type NavSection } from "@/components/layout/internal-nav";
import type { RoleKey } from "@/lib/domain/types";

interface InternalShellProps {
  area: "guest" | "staff" | "kitchen" | "admin";
  areaLabel: string;
  homeTo: string;
  children?: ReactNode;
}

export function InternalShell({ area, areaLabel, homeTo }: InternalShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const signOutFn = useServerFn(signOut);
  const { dataMode, refresh } = useAuth();
  const sessionUser = useSessionUser();
  const { role: mockRole, setRole: setMockRole, label } = useMockRoleContext();

  // In Supabase mode, the active role comes from the session. In mock mode,
  // the development-only role preview drives navigation filtering.
  const activeRole: RoleKey = dataMode === "mock" ? mockRole : (sessionUser?.roleKey ?? "guest");
  const isMockMode = dataMode === "mock";

  const sections: NavSection[] = filterNavByRole(AREA_NAV[area], activeRole);

  async function handleSignOut() {
    try {
      await signOutFn();
      await refresh();
      navigate({ to: "/" });
    } catch {
      navigate({ to: "/" });
    }
  }

  const displayName =
    dataMode === "mock"
      ? "Preview User"
      : sessionUser?.displayName || sessionUser?.email || "Account";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform border-r border-sidebar-border bg-sidebar transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <Link to={homeTo as never} className="flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-clay text-cream font-display font-bold">
              S
            </span>
            <span className="font-display text-sm font-bold text-sidebar-foreground">
              {areaLabel}
            </span>
          </Link>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent lg:hidden"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>

        <nav
          className="flex h-[calc(100vh-4rem)] flex-col overflow-y-auto px-3 py-4"
          aria-label={areaLabel}
        >
          <div className="flex-1 space-y-6">
            {sections.map((section) => (
              <div key={section.label}>
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = pathname === item.to || pathname.startsWith(item.to + "/");
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to as never}
                          onClick={() => setOpen(false)}
                          className={cn(
                            "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                            active
                              ? "bg-sidebar-primary text-sidebar-primary-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {/* Mock role preview — development only, never in Supabase mode */}
          {isMockMode && (
            <div className="mt-4 rounded-md border border-dashed border-gold/40 bg-gold/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gold">
                Mock role preview
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
              <label htmlFor="mock-role" className="sr-only">
                Mock role
              </label>
              <select
                id="mock-role"
                value={mockRole}
                onChange={(e) => setMockRole(e.target.value as RoleKey)}
                className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
              >
                {ROLE_KEYS.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sign out — available in both modes */}
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </nav>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-accent lg:hidden"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-6" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="relative inline-flex size-10 items-center justify-center rounded-md text-foreground hover:bg-accent"
              aria-label="Notifications"
            >
              <Bell className="size-5" />
              <span className="absolute right-2 top-2 size-2 rounded-full bg-clay" aria-hidden />
            </button>
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-sage/20 text-xs font-semibold text-sage">
                {ROLE_LABELS[activeRole].charAt(0)}
              </span>
              <div className="hidden text-left sm:block">
                <p className="text-xs font-medium text-foreground">{displayName}</p>
                <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[activeRole]}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <Container size="wide" className="py-8">
            <Outlet />
          </Container>
        </main>
      </div>
    </div>
  );
}
