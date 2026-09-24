import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { StatusBadge } from "@/components/layout/status-badge";
import { MOCK_WAITLIST } from "@/lib/mock";
import type { WaitlistEntry } from "@/lib/domain/types";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/waitlist")({
  head: () =>
    internalHead({
      title: "Waitlist — Staff — Sit Down Sundays",
      description: "Manage waitlist entries.",
    }),
  component: StaffWaitlist,
});

const columns: Column<WaitlistEntry>[] = [
  { key: "name", header: "Name", render: (w) => w.fullName },
  { key: "party", header: "Party", render: (w) => w.partySize },
  { key: "email", header: "Email", render: (w) => w.email, hideOnMobile: true },
  {
    key: "status",
    header: "Status",
    render: (w) => <StatusBadge tone="info">{w.status}</StatusBadge>,
  },
];

function StaffWaitlist() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Staff Operations"
        title="Waitlist"
        description="Review and manage waitlist entries."
      />
      <DataTable columns={columns} rows={MOCK_WAITLIST} rowKey={(w) => w.id} />
    </div>
  );
}
