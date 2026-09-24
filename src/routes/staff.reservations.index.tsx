import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { StatusBadge } from "@/components/layout/status-badge";
import { MOCK_RESERVATIONS } from "@/lib/mock";
import { RESERVATION_STATUS_LABELS, RESERVATION_STATUS_TONE } from "@/lib/domain/statuses";
import { formatCurrency } from "@/components/layout/currency-display";
import type { Reservation } from "@/lib/domain/types";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/reservations/")({
  head: () =>
    internalHead({
      title: "Reservations — Staff — Sit Down Sundays",
      description: "Manage all reservations.",
    }),
  component: StaffReservationsIndex,
});

const columns: Column<Reservation>[] = [
  {
    key: "confirmation",
    header: "Confirmation",
    render: (r) => (
      <Link
        to="/staff/reservations/$reservationId"
        params={{ reservationId: r.id }}
        className="font-medium text-clay hover:underline"
      >
        {r.confirmationNumber}
      </Link>
    ),
  },
  { key: "party", header: "Party", render: (r) => r.partySize },
  {
    key: "experience",
    header: "Experience",
    render: (r) => (r.experienceType === "private_room" ? "Private Room" : "Standard"),
    hideOnMobile: true,
  },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <StatusBadge tone={RESERVATION_STATUS_TONE[r.status]}>
        {RESERVATION_STATUS_LABELS[r.status]}
      </StatusBadge>
    ),
  },
  {
    key: "balance",
    header: "Balance",
    render: (r) => formatCurrency(r.remainingBalanceCents),
    hideOnMobile: true,
  },
];

function StaffReservationsIndex() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Staff Operations"
        title="Reservations"
        description="All reservations across upcoming Sundays."
      />
      <DataTable columns={columns} rows={MOCK_RESERVATIONS} rowKey={(r) => r.id} />
    </div>
  );
}
