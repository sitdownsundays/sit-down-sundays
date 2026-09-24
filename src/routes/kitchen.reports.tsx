import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { PrintableReportLayout } from "@/components/layout/printable-report-layout";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/kitchen/reports")({
  head: () =>
    internalHead({
      title: "Reports — Kitchen — Sit Down Sundays",
      description: "Kitchen preparation reports.",
    }),
  component: KitchenReports,
});

function KitchenReports() {
  return (
    <div className="space-y-8">
      <InternalPlaceholder
        eyebrow="Kitchen Workspace"
        title="Reports"
        description="Produce printable kitchen preparation reports."
      />
      <PrintableReportLayout
        title="Provisional Kitchen Preparation Report"
        meta={<span>Sample report — final data arrives in a later phase.</span>}
      >
        <p className="text-sm text-muted-foreground">
          Report contents will include counts by service, seating time, and dietary notes.
        </p>
      </PrintableReportLayout>
    </div>
  );
}
