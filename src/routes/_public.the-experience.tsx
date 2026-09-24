import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeading } from "@/components/layout/section-heading";
import { ButtonLink } from "@/components/layout/button-link";
import { Users, Clock, Heart, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_public/the-experience")({
  head: () => ({
    meta: [
      { title: "The Experience — Sit Down Sundays" },
      {
        name: "description",
        content:
          "What a Sit Down Sundays gathering feels like — warmth, family, and an unhurried shared meal.",
      },
      { property: "og:title", content: "The Experience — Sit Down Sundays" },
      { property: "og:description", content: "What a Sit Down Sundays gathering feels like." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExperiencePage,
});

function ExperiencePage() {
  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="The Experience"
        title="An unhurried Sunday at the table"
        description="A glimpse of what it feels like to sit down with us. Provisional — details refined closer to opening."
      />
      <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Clock,
            title: "Unhurried",
            body: "Seatings designed for lingering, not rushing. Time to talk between courses.",
          },
          {
            icon: Users,
            title: "Together",
            body: "Tables sized for family and friends, with room for every generation.",
          },
          {
            icon: Heart,
            title: "Warm",
            body: "A room that feels like home — soft light, comfort, and hospitality.",
          },
          {
            icon: Sparkles,
            title: "Considered",
            body: "Seasonal menus and thoughtful service, planned with care.",
          },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-card p-6">
            <f.icon className="mb-4 size-7 text-clay" aria-hidden />
            <h3 className="font-display text-lg font-semibold text-foreground">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>

      <section className="mt-16">
        <SectionHeading
          title="Standard seating vs. the private room"
          description="Two ways to gather, depending on your party."
        />
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-8">
            <h3 className="font-display text-xl font-bold text-foreground">Standard Seating</h3>
            <p className="mt-3 text-muted-foreground">
              The shared dining room — lively, warm, and open to all Sunday guests.
            </p>
            <ButtonLink to="/how-it-works" variant="ghost" className="mt-4">
              How it works
            </ButtonLink>
          </div>
          <div className="rounded-xl border border-gold/40 bg-gold/5 p-8">
            <h3 className="font-display text-xl font-bold text-foreground">The Private Room</h3>
            <p className="mt-3 text-muted-foreground">
              A dedicated space for larger parties and celebrations.
            </p>
            <ButtonLink to="/private-room" variant="ghost" className="mt-4">
              Explore the private room
            </ButtonLink>
          </div>
        </div>
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
        <ButtonLink to="/menu" variant="outline">
          See the menu
        </ButtonLink>
      </div>
    </Container>
  );
}
