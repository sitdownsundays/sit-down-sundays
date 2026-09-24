import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/emails")({
  head: () =>
    internalHead({
      title: "Emails — Admin — Sit Down Sundays",
      description: "Manage email templates.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Emails"
      description="Manage email templates and communications."
    />
  ),
});
