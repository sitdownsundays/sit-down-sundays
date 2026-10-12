import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ButtonLink } from "@/components/layout/button-link";
import { ArrowLeft } from "lucide-react";
import { internalHead } from "@/lib/head-meta";
import { roleHasPermission } from "@/lib/domain/roles";
import { useMockRole } from "@/lib/mock/mock-role-context";
import { useAuth, useSessionUser } from "@/lib/auth/auth-context";
import type { RoleKey } from "@/lib/domain/types";

export const Route = createFileRoute("/staff/reservations/$reservationId")({
  head: () =>
    internalHead({
      title: "Reservation — Staff — Sit Down Sundays",
      description: "Reservation detail.",
    }),
  component: StaffReservationDetail,
});

function StaffReservationDetail() {
  const { dataMode } = useAuth();
  const sessionUser = useSessionUser();
  const mockRole = useMockRole();
  // Same role resolution as the InternalShell: Supabase mode reads the
  // session role; mock mode reads the development-only role preview.
  const activeRole: RoleKey = dataMode === "mock" ? mockRole : (sessionUser?.roleKey ?? "guest");

  // The admin reservations dashboard is only useful to roles that can read
  // all reservations. reservations.read_all gates the admin reservations
  // workspace (foh_staff, ops_manager, administrator). Do not expose the
  // admin link to a role that cannot actually access it.
  const canOpenAdminReservations = roleHasPermission(activeRole, "reservations.read_all");

  return (
    <div className="space-y-8">
      <Link
        to="/staff/reservations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to staff reservations
      </Link>
      <PageHeader
        eyebrow="Reservation"
        title="Reservation Detail"
        description="Reservation reference"
      />
      <EmptyState
        title="Reservation management is available in the administration dashboard."
        description={
          canOpenAdminReservations
            ? "Open the administration dashboard to review this reservation's details, confirm, assign tables, and manage its status."
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
