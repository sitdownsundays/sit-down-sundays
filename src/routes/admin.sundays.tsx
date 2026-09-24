import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/sundays")({
  head: () =>
    internalHead({
      title: "Sundays — Admin — Sit Down Sundays",
      description: "Manage Sunday services.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Sundays"
      description="Manage Sunday service availability."
    />
  ),
});
