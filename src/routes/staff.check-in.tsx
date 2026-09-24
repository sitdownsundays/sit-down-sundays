import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/check-in")({
  head: () =>
    internalHead({ title: "Check-In — Staff — Sit Down Sundays", description: "Check guests in." }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Staff Operations"
      title="Check-In"
      description="Check arriving guests in and update status."
    />
  ),
});
