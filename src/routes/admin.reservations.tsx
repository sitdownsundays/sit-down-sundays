import { createFileRoute } from "@tanstack/react-router";
import { AdminReservationsPage } from "@/components/admin/admin-reservations";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/reservations")({
  head: () =>
    internalHead({
      title: "Reservations — Admin — Sit Down Sundays",
      description: "Review and manage reservation requests.",
    }),
  component: AdminReservationsPage,
});
