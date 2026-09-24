import { createFileRoute, Outlet } from "@tanstack/react-router";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/staff/reservations")({
  head: () =>
    internalHead({
      title: "Reservations — Staff — Sit Down Sundays",
      description: "Manage all reservations.",
    }),
  component: () => <Outlet />,
});
