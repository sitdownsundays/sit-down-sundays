import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/seating")({
  head: () =>
    internalHead({
      title: "Seating — Staff — Sit Down Sundays",
      description: "Table and seating layout.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Staff Operations"
      title="Seating"
      description="View tables, assign seats, and combine tables."
    />
  ),
});
