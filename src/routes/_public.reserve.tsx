import { createFileRoute } from "@tanstack/react-router";
import { BookingWizard } from "@/components/public/booking-wizard";

export const Route = createFileRoute("/_public/reserve")({
  head: () => ({
    meta: [
      { title: "Request a Reservation — Sit Down Sundays" },
      {
        name: "description",
        content:
          "Request a Sunday dining reservation at Sit Down Sundays. Choose a Sunday, tell us your party size, and we'll take it from there.",
      },
      { property: "og:title", content: "Request a Reservation — Sit Down Sundays" },
      {
        property: "og:description",
        content:
          "Request a Sunday dining reservation at Sit Down Sundays. Choose a Sunday, tell us your party size, and we'll take it from there.",
      },
    ],
    links: [{ rel: "canonical", href: "/reserve" }],
  }),
  component: ReservePage,
});

function ReservePage() {
  return <BookingWizard />;
}
