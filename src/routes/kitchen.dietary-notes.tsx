import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { MOCK_RESERVATIONS } from "@/lib/mock";
import type { Reservation } from "@/lib/domain/types";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/kitchen/dietary-notes")({
  head: () =>
    internalHead({
      title: "Dietary Notes — Kitchen — Sit Down Sundays",
      description: "Dietary and allergy notes.",
    }),
  component: DietaryNotes,
});

const columns: Column<Reservation>[] = [
  { key: "conf", header: "Confirmation", render: (r) => r.confirmationNumber },
  { key: "party", header: "Party", render: (r) => r.partySize },
  { key: "notes", header: "Dietary notes", render: (r) => r.dietaryNotes ?? "—" },
];

function DietaryNotes() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Kitchen Workspace"
        title="Dietary Notes"
        description="Allergy and dietary notes by reservation."
      />
      <DataTable columns={columns} rows={MOCK_RESERVATIONS} rowKey={(r) => r.id} />
    </div>
  );
}
