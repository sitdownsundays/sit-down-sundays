import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/layout/button-link";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";

export const Route = createFileRoute("/_public/waitlist")({
  head: () => ({
    meta: [
      { title: "Join the Waitlist — Sit Down Sundays" },
      {
        name: "description",
        content:
          "Join the Sit Down Sundays waitlist to be among the first invited when reservations open.",
      },
      { property: "og:title", content: "Join the Waitlist — Sit Down Sundays" },
      { property: "og:description", content: "Be among the first invited when reservations open." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WaitlistPage,
});

function WaitlistPage() {
  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="Waitlist"
        title="Join the Waitlist"
        description="Be among the first invited when reservations open. Joining the waitlist is not a confirmed reservation."
      />
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="order-2 lg:order-1">
          <WaitlistForm />
        </div>
        <aside className="order-1 space-y-4 lg:order-2">
          <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">What happens next?</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>We'll notify waitlist members first when reservations open.</li>
              <li>You'll receive an invitation to create a guest account.</li>
              <li>Then you can choose a Sunday and begin booking.</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Good to know</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Marketing consent is optional and separate from joining.</li>
              <li>We won't share your details.</li>
              <li>Booking is not yet open.</li>
            </ul>
          </div>
          <ButtonLink to="/how-it-works" variant="outline" className="w-full">
            See how it works
          </ButtonLink>
        </aside>
      </div>
    </Container>
  );
}
