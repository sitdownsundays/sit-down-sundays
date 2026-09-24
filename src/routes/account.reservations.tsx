import { createFileRoute, Outlet } from "@tanstack/react-router";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/account/reservations")({
  head: () =>
    internalHead({
      title: "My Reservations — Sit Down Sundays",
      description: "Your reservations.",
    }),
  component: () => <Outlet />,
});
