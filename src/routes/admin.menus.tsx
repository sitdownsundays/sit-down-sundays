import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/menus")({
  head: () =>
    internalHead({ title: "Menus — Admin — Sit Down Sundays", description: "Manage menus." }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Menus"
      description="Create and publish menus."
    />
  ),
});
