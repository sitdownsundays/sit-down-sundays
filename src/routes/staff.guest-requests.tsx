import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { StatusBadge } from "@/components/layout/status-badge";
import { MOCK_GUEST_REQUESTS } from "@/lib/mock";
import type { GuestRequest } from "@/lib/domain/types";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/guest-requests")({
  head: () =>
    internalHead({
      title: "Guest Requests — Staff — Sit Down Sundays",
      description: "Review guest requests.",
    }),
  component: StaffGuestRequests,
});

const columns: Column<GuestRequest>[] = [
  { key: "subject", header: "Subject", render: (g) => g.subject },
  { key: "category", header: "Category", render: (g) => g.category, hideOnMobile: true },
  {
    key: "status",
    header: "Status",
    render: (g) => <StatusBadge tone="warning">{g.status}</StatusBadge>,
  },
];

function StaffGuestRequests() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Staff Operations"
        title="Guest Requests"
        description="Review and respond to guest questions and requests."
      />
      <DataTable columns={columns} rows={MOCK_GUEST_REQUESTS} rowKey={(g) => g.id} />
    </div>
  );
}
