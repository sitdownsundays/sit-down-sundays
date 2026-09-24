import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/calendar")({
  head: () =>
    internalHead({
      title: "Calendar — Staff — Sit Down Sundays",
      description: "Sunday service calendar.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Staff Operations"
      title="Calendar"
      description="View and manage Sunday service availability."
    />
  ),
});
