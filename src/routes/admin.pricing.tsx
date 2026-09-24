import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/pricing")({
  head: () =>
    internalHead({ title: "Pricing — Admin — Sit Down Sundays", description: "Manage pricing." }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Pricing"
      description="Manage base pricing."
    />
  ),
});
