import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/layout/status-badge";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";
import { ArrowLeft } from "lucide-react";
import { MOCK_RESERVATIONS } from "@/lib/mock";
import {
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
} from "@/lib/domain/statuses";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/reservations/$reservationId")({
  head: () =>
    internalHead({
      title: "Reservation — Staff — Sit Down Sundays",
      description: "Reservation detail.",
    }),
  component: StaffReservationDetail,
});

function StaffReservationDetail() {
  const { reservationId } = useParams({ from: "/staff/reservations/$reservationId" });
  const reservation = MOCK_RESERVATIONS.find((r) => r.id === reservationId);

  if (!reservation) {
    return (
      <div className="space-y-6">
        <Link
          to="/staff/reservations"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <PlaceholderPanel
          title="Reservation not found"
          description={`No reservation with id ${reservationId}.`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Link
        to="/staff/reservations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to reservations
      </Link>
      <PageHeader
        eyebrow="Reservation"
        title={reservation.confirmationNumber}
        description={`Party of ${reservation.partySize}`}
        actions={
          <div className="flex gap-2">
            <StatusBadge tone={RESERVATION_STATUS_TONE[reservation.status]}>
              {RESERVATION_STATUS_LABELS[reservation.status]}
            </StatusBadge>
            <StatusBadge tone="neutral">
              {PAYMENT_STATUS_LABELS[reservation.paymentStatus]}
            </StatusBadge>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <PlaceholderPanel
          title="Guest & party details"
          description="Guest owner, party composition, and dietary notes appear here."
        />
        <PlaceholderPanel
          title="Table assignment & seating"
          description="Assign and combine tables in a later phase."
        />
        <PlaceholderPanel
          title="Internal notes"
          description="Internal notes (never shown to guests) appear here."
        />
        <PlaceholderPanel
          title="Status actions"
          description="Check-in, transfer, and cancellation handling arrive in a later phase."
        />
      </div>
    </div>
  );
}
