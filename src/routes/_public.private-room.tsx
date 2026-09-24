import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/layout/button-link";
import { MOCK_PRIVATE_ROOMS } from "@/lib/mock";
import { CurrencyDisplay } from "@/components/layout/currency-display";

export const Route = createFileRoute("/_public/private-room")({
  head: () => ({
    meta: [
      { title: "Private Room — Sit Down Sundays" },
      {
        name: "description",
        content:
          "A dedicated private room for larger gatherings and celebrations at Sit Down Sundays.",
      },
      { property: "og:title", content: "Private Room — Sit Down Sundays" },
      {
        property: "og:description",
        content: "A dedicated private room for larger gatherings and celebrations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PrivateRoomPage,
});

function PrivateRoomPage() {
  const room = MOCK_PRIVATE_ROOMS[0];
  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="Private Room"
        title="A room of your own"
        description="For larger parties and special celebrations. Provisional — details finalized before opening."
      />
      <div className="mt-12 grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className="font-display text-2xl font-bold text-foreground">{room.name}</h2>
          <p className="text-muted-foreground">
            A dedicated space for your party, set apart from the main room — ideal for birthdays,
            family milestones, and gatherings that deserve a little more room.
          </p>
          <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5 text-sm">
            <div>
              <dt className="text-muted-foreground">Minimum guests</dt>
              <dd className="font-medium text-foreground">{room.minGuests}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Maximum guests</dt>
              <dd className="font-medium text-foreground">{room.maxGuests}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Room fee (provisional)</dt>
              <dd className="font-medium text-foreground">
                <CurrencyDisplay cents={room.feeCents} />
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
          Private room photo — coming soon
        </div>
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
        <ButtonLink to="/contact" variant="outline">
          Ask about availability
        </ButtonLink>
      </div>
    </Container>
  );
}
