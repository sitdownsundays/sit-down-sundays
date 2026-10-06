import { createFileRoute } from "@tanstack/react-router";
import { AdminFeastOfferingsPage } from "@/components/admin/admin-feast-offerings";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/menu-items")({
  head: () =>
    internalHead({
      title: "Feast Offerings — Admin — Sit Down Sundays",
      description: "Manage curated feast offerings and showcase items.",
    }),
  component: AdminFeastOfferingsPage,
});
