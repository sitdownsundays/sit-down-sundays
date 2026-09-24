import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/account/payments")({
  head: () =>
    internalHead({
      title: "My Payments — Sit Down Sundays",
      description: "Your payment status and history.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Guest Portal"
      title="My Payments"
      description="Deposit and balance status for your reservations."
    />
  ),
});
