import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/kitchen/preparation")({
  head: () =>
    internalHead({
      title: "Preparation — Kitchen — Sit Down Sundays",
      description: "Kitchen preparation reports.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Kitchen Workspace"
      title="Preparation"
      description="Preparation reports by service and seating time."
    />
  ),
});
