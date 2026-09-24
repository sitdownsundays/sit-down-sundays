import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/content")({
  head: () =>
    internalHead({
      title: "Content — Admin — Sit Down Sundays",
      description: "Manage public content.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Content"
      description="Manage public website content pages."
    />
  ),
});
