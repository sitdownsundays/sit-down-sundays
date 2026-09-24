import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/tables")({
  head: () =>
    internalHead({
      title: "Tables — Admin — Sit Down Sundays",
      description: "Manage tables and capacity.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Tables"
      description="Manage tables, zones, and combinability."
    />
  ),
});
