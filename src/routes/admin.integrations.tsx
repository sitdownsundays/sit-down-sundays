import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/integrations")({
  head: () =>
    internalHead({
      title: "Integrations — Admin — Sit Down Sundays",
      description: "Manage integrations.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Integrations"
      description="Manage third-party integrations."
    />
  ),
});
