import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/private-room")({
  head: () =>
    internalHead({
      title: "Private Room — Admin — Sit Down Sundays",
      description: "Manage private room availability.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Private Room"
      description="Manage private room availability, capacity, and fees."
    />
  ),
});
