import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/audit-log")({
  head: () =>
    internalHead({
      title: "Audit Log — Admin — Sit Down Sundays",
      description: "Review audit history.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Audit Log"
      description="Review sensitive-change audit history."
    />
  ),
});
