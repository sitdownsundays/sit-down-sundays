import { createFileRoute } from "@tanstack/react-router";
import { AdminOrderingPage } from "@/components/admin/admin-ordering";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/ordering")({
  head: () =>
    internalHead({
      title: "Ordering Configuration — Admin — Sit Down Sundays",
      description:
        "Manage meal packages, individual add-ons, shared platters, and guest pricing rules.",
    }),
  component: AdminOrderingPage,
});
