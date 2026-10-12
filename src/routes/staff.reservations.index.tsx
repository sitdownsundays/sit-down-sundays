import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ButtonLink } from "@/components/layout/button-link";
import { internalHead } from "@/lib/head-meta";
import { roleHasPermission } from "@/lib/domain/roles";
import { useMockRole } from "@/lib/mock/mock-role-context";
import { useAuth, useSessionUser } from "@/lib/auth/auth-context";
import type { RoleKey } from "@/lib/domain/types";

export const Route = createFileRoute("/staff/reservations/")({
  head: () =>
    internalHead({
      title: "Reservations — Staff — Sit Down Sundays",
      description: "Manage all reservations.",
    }),
  component: StaffReservationsIndex,
});

function StaffReservationsIndex() {
  const { dataMode } = useAuth();
  const sessionUser = useSessionUser();
  const mockRole = useMockRole();
  // Same role resolution the InternalShell uses: Supabase mode reads the
  // session role; mock mode reads the development-only role preview.
  const activeRole: RoleKey = dataMode === "mock" ? mockRole : (sessionUser?.roleKey ?? "guest");

  // The /admin layout guard admits any INTERNAL_ROLES user, but the real
  // reservations dashboard is only useful to roles that can read all
  // reservations. reservations.read_all is the exact permission that
  // gates the admin reservations workspace (foh_staff, ops_manager,
  // administrator). Do not show an admin link to a role that cannot use it.
  const canOpenAdminReservations = roleHasPermission(activeRole, "reservations.read_all");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Staff Operations"
        title="Reservations"
        description="Reservation requests and party bookings."
      />
      <EmptyState
        title="Reservation management is available in the administration dashboard."
        description={
          canOpenAdminReservations
            ? "Open the administration dashboard to review, confirm, assign tables, and manage reservation requests."
            : "Please ask an authorized manager to review the reservation."
        }
        action={
          canOpenAdminReservations ? (
            <ButtonLink to="/admin/reservations">Open reservations</ButtonLink>
          ) : undefined
        }
      />
    </div>
  );
}
