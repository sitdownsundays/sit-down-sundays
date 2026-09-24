import { createFileRoute, Outlet } from "@tanstack/react-router";
import { InternalShell } from "@/components/layout/internal-shell";
import { requireInternalRole, INTERNAL_ROLES } from "@/lib/auth/guards";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin")({
  beforeLoad: ({ context, location }) => {
    requireInternalRole(context.session, INTERNAL_ROLES, location.pathname);
  },
  head: () =>
    internalHead({ title: "Administration — Sit Down Sundays", description: "Admin workspace." }),
  component: () => (
    <InternalShell area="admin" areaLabel="Administration" homeTo="/admin">
      <Outlet />
    </InternalShell>
  ),
});
