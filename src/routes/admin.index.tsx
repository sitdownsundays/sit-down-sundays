import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";
import { MOCK_RESERVATIONS, MOCK_MENU_ITEMS, MOCK_USERS, MOCK_WAITLIST } from "@/lib/mock";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/")({
  head: () =>
    internalHead({
      title: "Admin Dashboard — Sit Down Sundays",
      description: "Administration dashboard.",
    }),
  component: AdminDashboard,
});

function AdminDashboard() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Dashboard"
        description="Platform-wide overview."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Users" value={MOCK_USERS.length} />
        <StatCard label="Reservations" value={MOCK_RESERVATIONS.length} />
        <StatCard label="Menu items" value={MOCK_MENU_ITEMS.length} />
        <StatCard label="Waitlist" value={MOCK_WAITLIST.length} />
      </div>
      <PlaceholderPanel
        title="Administrative controls"
        description="Content, operations, finance, and system management arrive in later phases."
      />
    </div>
  );
}
