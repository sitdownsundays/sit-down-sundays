import { createFileRoute, Outlet } from "@tanstack/react-router";
import { InternalShell } from "@/components/layout/internal-shell";
import { requireAuth } from "@/lib/auth/guards";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/account")({
  beforeLoad: ({ context, location }) => {
    requireAuth(context.session, location.pathname);
  },
  head: () =>
    internalHead({ title: "My Account — Sit Down Sundays", description: "Your guest account." }),
  component: () => (
    <InternalShell area="guest" areaLabel="Guest Portal" homeTo="/account">
      <Outlet />
    </InternalShell>
  ),
});
