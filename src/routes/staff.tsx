import { createFileRoute, Outlet } from "@tanstack/react-router";
import { InternalShell } from "@/components/layout/internal-shell";
import { requireInternalRole, INTERNAL_ROLES } from "@/lib/auth/guards";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff")({
  beforeLoad: ({ context, location }) => {
    requireInternalRole(context.session, INTERNAL_ROLES, location.pathname);
  },
  head: () =>
    internalHead({ title: "Staff Operations — Sit Down Sundays", description: "Staff workspace." }),
  component: () => (
    <InternalShell area="staff" areaLabel="Staff Operations" homeTo="/staff">
      <Outlet />
    </InternalShell>
  ),
});
