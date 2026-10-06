import { createFileRoute } from "@tanstack/react-router";
import { AdminSettingsPage } from "@/components/admin/admin-settings";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/settings")({
  head: () =>
    internalHead({
      title: "Settings — Admin — Sit Down Sundays",
      description: "Manage payment and operating settings.",
    }),
  component: AdminSettingsPage,
});
