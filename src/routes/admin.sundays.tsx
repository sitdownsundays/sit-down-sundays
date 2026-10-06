import { createFileRoute } from "@tanstack/react-router";
import { AdminSundaysPage } from "@/components/admin/admin-sundays";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/sundays")({
  head: () =>
    internalHead({
      title: "Sundays & Seating — Admin — Sit Down Sundays",
      description: "Manage Sunday services, seating times, and capacity.",
    }),
  component: AdminSundaysPage,
});
