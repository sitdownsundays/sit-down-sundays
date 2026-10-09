import { createFileRoute } from "@tanstack/react-router";
import { AdminTablesPage } from "@/components/admin/admin-tables";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/tables")({
  head: () =>
    internalHead({
      title: "Tables — Admin — Sit Down Sundays",
      description: "Manage physical dining tables by room.",
    }),
  component: AdminTablesPage,
});
