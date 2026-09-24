import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";
import { MOCK_RESERVATIONS } from "@/lib/mock";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/kitchen/")({
  head: () =>
    internalHead({
      title: "Kitchen Workspace — Sit Down Sundays",
      description: "Kitchen preparation workspace.",
    }),
  component: KitchenDashboard,
});

function KitchenDashboard() {
  const covers = MOCK_RESERVATIONS.reduce((s, r) => s + r.partySize, 0);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Kitchen Workspace"
        title="Today's Service"
        description="Meal totals and preparation overview. No financial information shown."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Covers" value={covers} />
        <StatCard label="Reservations" value={MOCK_RESERVATIONS.length} />
        <StatCard label="Dietary notes" value={1} hint="Review required" />
      </div>
      <PlaceholderPanel
        title="Preparation board"
        description="Live meal totals and prep reports arrive in a later phase."
      />
    </div>
  );
}
