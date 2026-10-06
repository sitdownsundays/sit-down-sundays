import { createFileRoute } from "@tanstack/react-router";
import { AdminSpacesPage } from "@/components/admin/admin-spaces";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/spaces")({
  head: () =>
    internalHead({
      title: "Venue Spaces — Admin — Sit Down Sundays",
      description: "Manage physical venue spaces and their saleability posture.",
    }),
  component: AdminSpacesPage,
});
