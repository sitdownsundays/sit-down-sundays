import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/layout/status-badge";
import { PriceBreakdown } from "@/components/layout/price-breakdown";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";
import { ButtonLink } from "@/components/layout/button-link";
import { ArrowLeft } from "lucide-react";
import { MOCK_RESERVATIONS } from "@/lib/mock";
import {
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
} from "@/lib/domain/statuses";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/account/reservations/$reservationId")({
  head: () =>
    internalHead({
      title: "Reservation Detail — Sit Down Sundays",
      description: "Your reservation detail.",
    }),
  component: ReservationDetail,
});

function ReservationDetail() {
  const { reservationId } = useParams({ from: "/account/reservations/$reservationId" });
  const reservation = MOCK_RESERVATIONS.find((r) => r.id === reservationId);

  if (!reservation) {
    return (
      <div className="space-y-6">
        <Link
          to="/account/reservations"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to reservations
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
        to="/account/reservations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to reservations
      </Link>
      <PageHeader
        eyebrow="Reservation"
        title={reservation.confirmationNumber}
        description={`Party of ${reservation.partySize} · ${reservation.experienceType === "private_room" ? "Private Room" : "Standard Seating"}`}
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
        <PriceBreakdown
          lines={[
            { label: "Subtotal", cents: reservation.pricing.subtotalCents },
            {
              label: "Private room fee",
              cents: reservation.pricing.privateRoomFeeCents,
              muted: true,
            },
            {
              label: "Deposit required",
              cents: reservation.pricing.depositRequiredCents,
              muted: true,
            },
            { label: "Amount paid", cents: reservation.amountPaidCents },
            {
              label: "Remaining balance",
              cents: reservation.remainingBalanceCents,
              emphasis: true,
            },
          ]}
        />
        <div className="space-y-4">
          <PlaceholderPanel
            title="Meal selections"
            description="Itemized meal selections appear here in a later phase."
          />
          <PlaceholderPanel
            title="Manage reservation"
            description="Eligible edits, transfers, and cancellation requests arrive in a later phase."
          />
          <ButtonLink to="/account/payments" variant="outline">
            View payments
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
