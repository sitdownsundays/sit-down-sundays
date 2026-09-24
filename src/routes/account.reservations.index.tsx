import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { ReservationCard } from "@/components/layout/reservation-card";
import { EmptyState } from "@/components/layout/empty-state";
import { ButtonLink } from "@/components/layout/button-link";
import { MOCK_RESERVATIONS } from "@/lib/mock";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/account/reservations/")({
  head: () =>
    internalHead({
      title: "My Reservations — Sit Down Sundays",
      description: "Your reservations.",
    }),
  component: AccountReservationsIndex,
});

function AccountReservationsIndex() {
  const reservations = MOCK_RESERVATIONS;
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Guest Portal"
        title="My Reservations"
        description="All your Sit Down Sundays reservations."
      />
      {reservations.length === 0 ? (
        <EmptyState
          title="No reservations yet"
          description="When you book a Sunday, it will appear here."
          action={<ButtonLink to="/waitlist">Join the waitlist</ButtonLink>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reservations.map((r) => (
            <ReservationCard key={r.id} reservation={r} to="/account/reservations/$reservationId" />
          ))}
        </div>
      )}
    </div>
  );
}
