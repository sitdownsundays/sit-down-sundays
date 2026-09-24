import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/fees")({
  head: () =>
    internalHead({ title: "Fees — Admin — Sit Down Sundays", description: "Manage fees." }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Fees"
      description="Manage service and processing fees."
    />
  ),
});
