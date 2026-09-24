import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/account/support")({
  head: () =>
    internalHead({
      title: "Support — Sit Down Sundays",
      description: "Submit questions and requests.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Guest Portal"
      title="Support"
      description="Submit questions and requests about your reservations."
    />
  ),
});
