import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ButtonLink } from "@/components/layout/button-link";
import { ArrowLeft } from "lucide-react";
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
        title="Reservation Detail"
        description="Reservation reference"
      />
      <EmptyState
        title="Online reservation tracking is not available yet."
        description="Please contact our team with your reservation reference for updates."
        action={<ButtonLink to="/contact">Contact our team</ButtonLink>}
      />
    </div>
  );
}
