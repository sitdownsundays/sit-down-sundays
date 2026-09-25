import { createFileRoute } from "@tanstack/react-router";
import { AdminMenusPage } from "@/components/admin/admin-menus";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/menus")({
  head: () =>
    internalHead({
      title: "Menus — Admin — Sit Down Sundays",
      description: "Create, edit, publish, and archive menus.",
    }),
  component: AdminMenusPage,
});
