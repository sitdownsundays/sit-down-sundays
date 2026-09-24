import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/navigation")({
  head: () =>
    internalHead({
      title: "Navigation — Admin — Sit Down Sundays",
      description: "Manage site navigation.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Navigation"
      description="Manage public site navigation menus."
    />
  ),
});
