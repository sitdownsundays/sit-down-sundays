import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/media")({
  head: () =>
    internalHead({
      title: "Media — Admin — Sit Down Sundays",
      description: "Manage media assets.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Media"
      description="Manage images and media assets."
    />
  ),
});
