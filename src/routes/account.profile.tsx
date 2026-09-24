import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/account/profile")({
  head: () =>
    internalHead({
      title: "My Profile — Sit Down Sundays",
      description: "Edit your guest profile.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Guest Portal"
      title="My Profile"
      description="Manage your personal details and dietary preferences."
    />
  ),
});
