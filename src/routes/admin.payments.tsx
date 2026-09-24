import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/payments")({
  head: () =>
    internalHead({ title: "Payments — Admin — Sit Down Sundays", description: "Review payments." }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Payments"
      description="Review deposits, balances, and refunds."
    />
  ),
});
