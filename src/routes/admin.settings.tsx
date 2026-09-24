import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/settings")({
  head: () =>
    internalHead({
      title: "Settings — Admin — Sit Down Sundays",
      description: "Application settings.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Settings"
      description="Manage business rules and application settings."
    />
  ),
});
