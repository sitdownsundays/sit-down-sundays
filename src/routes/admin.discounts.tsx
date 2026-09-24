import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/discounts")({
  head: () =>
    internalHead({
      title: "Discounts — Admin — Sit Down Sundays",
      description: "Manage discounts.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Discounts"
      description="Manage discounts and promotions."
    />
  ),
});
