import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/reports")({
  head: () =>
    internalHead({
      title: "Reports — Admin — Sit Down Sundays",
      description: "Operating reports.",
    }),
  component: () => (
    <InternalPlaceholder
      eyebrow="Administration"
      title="Reports"
      description="Produce weekly operating reports."
    />
  ),
});
