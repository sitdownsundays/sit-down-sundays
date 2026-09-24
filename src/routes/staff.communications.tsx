import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/communications")({
  head: () =>
    internalHead({
      title: "Communications — Staff — Sit Down Sundays",
      description: "Manage guest communications.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Staff Operations"
      title="Communications"
      description="Send and review guest communications."
    />
  ),
});
