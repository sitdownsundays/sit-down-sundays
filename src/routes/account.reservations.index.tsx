import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ButtonLink } from "@/components/layout/button-link";
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
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Guest Portal"
        title="My Reservations"
        description="All your Sit Down Sundays reservations."
      />
      <EmptyState
        title="Online reservation tracking is not available yet."
        description="Please contact our team with your reservation reference for updates."
        action={<ButtonLink to="/contact">Contact our team</ButtonLink>}
      />
    </div>
  );
}
