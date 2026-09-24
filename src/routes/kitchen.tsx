import { createFileRoute, Outlet } from "@tanstack/react-router";
import { InternalShell } from "@/components/layout/internal-shell";
import { requireInternalRole, INTERNAL_ROLES } from "@/lib/auth/guards";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/kitchen")({
  beforeLoad: ({ context, location }) => {
    requireInternalRole(context.session, INTERNAL_ROLES, location.pathname);
  },
  head: () =>
    internalHead({
      title: "Kitchen Workspace — Sit Down Sundays",
      description: "Kitchen workspace.",
    }),
  component: () => (
    <InternalShell area="kitchen" areaLabel="Kitchen Workspace" homeTo="/kitchen">
      <Outlet />
    </InternalShell>
  ),
});
