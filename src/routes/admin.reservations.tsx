import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/reservations")({
  head: () =>
    internalHead({
      title: "Reservations — Admin — Sit Down Sundays",
      description: "Manage all reservations.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Reservations"
      description="Review and manage all reservations."
    />
  ),
});
