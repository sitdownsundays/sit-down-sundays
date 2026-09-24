import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";
import { ButtonLink } from "@/components/layout/button-link";

export const Route = createFileRoute("/_public/book")({
  head: () => ({
    meta: [
      { title: "Book — Sit Down Sundays" },
      {
        name: "description",
        content: "Booking is coming soon. Join the Sit Down Sundays waitlist to be invited first.",
      },
      { property: "og:title", content: "Book — Sit Down Sundays" },
      { property: "og:description", content: "Booking is coming soon. Join the waitlist." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BookPage,
});

function BookPage() {
  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="Booking"
        title="Booking is coming soon"
        description="We're not taking reservations just yet — but the waitlist is open."
      />
      <div className="mt-8 space-y-6">
        <PlaceholderPanel
          title="Booking opens soon"
          description="The full booking experience — Sunday selection, seating times, party composition, meal selection, and deposit payment — will be available once reservations open."
        />
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-clay/30 bg-clay/5 p-5">
          <p className="flex-1 text-sm text-foreground">
            Join the waitlist to be among the first invited to book.
          </p>
          <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
        </div>
      </div>
    </Container>
  );
}
