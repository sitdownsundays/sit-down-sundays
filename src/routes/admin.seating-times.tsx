import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/seating-times")({
  head: () =>
    internalHead({
      title: "Seating Times — Admin — Sit Down Sundays",
      description: "Manage seating times.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Seating Times"
      description="Manage seating times and capacity."
    />
  ),
});
