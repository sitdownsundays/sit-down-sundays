import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/walk-ins")({
  head: () =>
    internalHead({
      title: "Walk-Ins — Staff — Sit Down Sundays",
      description: "Add and seat walk-in guests.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Staff Operations"
      title="Walk-Ins"
      description="Add walk-in guests and assign available tables."
    />
  ),
});
