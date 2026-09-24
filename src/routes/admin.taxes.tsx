import { createFileRoute } from "@tanstack/react-router";
import { InternalPlaceholder } from "@/components/layout/internal-placeholder";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/taxes")({
  head: () =>
    internalHead({ title: "Taxes — Admin — Sit Down Sundays", description: "Manage taxes." }),
  component: () => (
    <InternalPlaceholder eyebrow="Administration" title="Taxes" description="Manage tax rates." />
  ),
});
