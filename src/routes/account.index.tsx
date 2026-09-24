import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { ReservationCard } from "@/components/layout/reservation-card";
import { EmptyState } from "@/components/layout/empty-state";
import { ButtonLink } from "@/components/layout/button-link";
import { MOCK_RESERVATIONS } from "@/lib/mock";
import { formatCurrency } from "@/components/layout/currency-display";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/account/")({
  head: () =>
    internalHead({
      title: "My Account — Sit Down Sundays",
      description: "Your guest account overview.",
    }),
  component: AccountOverview,
});

function AccountOverview() {
  const reservations = MOCK_RESERVATIONS;
  const balance = reservations.reduce((s, r) => s + r.remainingBalanceCents, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Guest Portal"
        title="Welcome back"
        description="An overview of your reservations and payments."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Reservations" value={reservations.length} />
        <StatCard label="Balance due" value={formatCurrency(balance)} />
        <StatCard label="Next Sunday" value="Pending" hint="Awaiting confirmation" />
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-foreground">
            Upcoming reservations
          </h2>
          <ButtonLink to="/account/reservations" variant="ghost">
            View all
          </ButtonLink>
        </div>
        {reservations.length === 0 ? (
          <EmptyState
            title="No reservations yet"
            description="When you book a Sunday, it will appear here."
            action={<ButtonLink to="/waitlist">Join the waitlist</ButtonLink>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {reservations.map((r) => (
              <ReservationCard
                key={r.id}
                reservation={r}
                to="/account/reservations/$reservationId"
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link to="/account/profile" className="text-sm font-medium text-clay hover:underline">
          Edit profile
        </Link>
        <Link
          to="/account/support"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Get support
        </Link>
      </div>
    </div>
  );
}
