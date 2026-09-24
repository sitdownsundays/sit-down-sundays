import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";
import { MOCK_RESERVATIONS, MOCK_WAITLIST } from "@/lib/mock";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/")({
  head: () =>
    internalHead({
      title: "Staff Dashboard — Sit Down Sundays",
      description: "Front-of-house operations dashboard.",
    }),
  component: StaffDashboard,
});

function StaffDashboard() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Staff Operations"
        title="Dashboard"
        description="Today's front-of-house overview."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Reservations" value={MOCK_RESERVATIONS.length} />
        <StatCard label="Waitlist" value={MOCK_WAITLIST.length} />
        <StatCard label="Check-ins" value={0} hint="Awaiting service" />
        <StatCard label="Walk-ins" value={0} />
      </div>
      <PlaceholderPanel
        title="Live operations board"
        description="Real-time check-in, seating, and walk-in management arrives in a later phase."
      />
    </div>
  );
}
