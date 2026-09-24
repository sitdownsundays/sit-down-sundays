import { Link } from "@tanstack/react-router";
import { CalendarHeart, Users, UtensilsCrossed, ArrowRight } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { SectionHeading } from "@/components/layout/section-heading";
import { ButtonLink } from "@/components/layout/button-link";
import { MenuItemCard } from "@/components/layout/menu-item-card";
import { HomeHero } from "@/components/layout/home-hero";
import { HERO_IMAGE_SRC } from "@/lib/content/hero-content";
import { MOCK_MENU_ITEMS } from "@/lib/mock";

export const Route = createFileRoute("/_public/")({
  head: () => ({
    meta: [
      { title: "Sit Down Sundays — A Curated Sunday Dining Experience" },
      {
        name: "description",
        content:
          "Gather around the table. A curated Sunday dining experience built around family, warmth, and shared meals. Join the waitlist.",
      },
      { property: "og:title", content: "Sit Down Sundays" },
      {
        property: "og:description",
        content: "A curated Sunday dining experience. Join the waitlist.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: HERO_IMAGE_SRC },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: HERO_IMAGE_SRC },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <>
      {/* Hero — full-width image cover */}
      <HomeHero />

      {/* Introduction */}
      <Container className="py-20">
        <SectionHeading
          centered
          title="A table set for everyone"
          description="Sit Down Sundays began with a simple idea: that the best conversations happen when we slow down, pass the bread, and stay a little longer than we planned."
        />
      </Container>

      {/* What it feels like */}
      <section className="bg-muted/40">
        <Container className="grid gap-8 py-20 sm:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Family at the center",
              body: "Tables sized for gathering, not rushing. Space for children, grandparents, and everyone between.",
            },
            {
              icon: CalendarHeart,
              title: "A Sunday tradition",
              body: "One day a week, one table, one unhurried meal. A rhythm worth keeping.",
            },
            {
              icon: UtensilsCrossed,
              title: "Thoughtfully plated",
              body: "A seasonal menu that changes with the calendar — provisional now, refined by opening.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-6">
              <f.icon className="mb-4 size-7 text-clay" aria-hidden />
              <h3 className="font-display text-xl font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </Container>
      </section>

      {/* How it works */}
      <Container className="py-20">
        <SectionHeading
          title="How it works"
          description="A simple path from curiosity to a seat at the table."
        />
        <ol className="mt-10 grid gap-8 sm:grid-cols-4">
          {[
            "Join the waitlist",
            "Choose your Sunday",
            "Select your seating & meals",
            "Pay a deposit & arrive",
          ].map((step, i) => (
            <li key={step} className="relative space-y-2">
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-clay text-cream font-display font-bold">
                {i + 1}
              </span>
              <p className="font-medium text-foreground">{step}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8">
          <ButtonLink to="/how-it-works" variant="ghost">
            See the full process <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
      </Container>

      {/* Featured menu preview */}
      <section className="bg-gradient-to-b from-cream via-muted/50 to-cream">
        <Container className="py-24">
          <SectionHeading
            centered
            title="A taste of the table"
            description="A provisional look at what may be served. Final menu and prices to be confirmed before opening."
          />
          <div className="mt-12 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {MOCK_MENU_ITEMS.slice(0, 6).map((item) => (
              <MenuItemCard key={item.id} item={item} className="h-full" />
            ))}
          </div>
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <ButtonLink to="/menu" size="lg">
              Explore the Full Menu <ArrowRight className="size-4" />
            </ButtonLink>
            <p className="text-sm text-muted-foreground">
              Provisional menu — final details coming soon.
            </p>
          </div>
        </Container>
      </section>

      {/* Standard seating & private room */}
      <Container className="grid gap-8 py-20 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-8">
          <h3 className="font-display text-2xl font-bold text-foreground">Standard Seating</h3>
          <p className="mt-3 text-muted-foreground">
            Join the shared room among other Sunday guests. Warm, lively, and welcoming — the heart
            of the experience.
          </p>
          <ButtonLink to="/the-experience" variant="ghost" className="mt-4">
            Learn more <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-8">
          <h3 className="font-display text-2xl font-bold text-foreground">The Private Room</h3>
          <p className="mt-3 text-muted-foreground">
            For larger gatherings and celebrations — a dedicated room for your party, with its own
            fee and capacity.
          </p>
          <ButtonLink to="/private-room" variant="ghost" className="mt-4">
            Explore the private room <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
      </Container>

      {/* Family & community value */}
      <section className="bg-charcoal text-cream">
        <Container className="py-20 text-center">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">More than a meal.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-cream/80">
            Sit Down Sundays is about the people around the table — the laughter between courses,
            the stories passed alongside the bread. We're building a place where community is the
            main course.
          </p>
        </Container>
      </section>

      {/* Gallery placeholder */}
      <Container className="py-20">
        <SectionHeading
          centered
          title="A glimpse of Sundays"
          description="Gallery coming soon — provisional placeholder."
        />
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 text-sm text-muted-foreground"
            >
              Image {i}
            </div>
          ))}
        </div>
      </Container>

      {/* FAQ preview */}
      <section className="bg-muted/40">
        <Container className="py-20">
          <SectionHeading
            centered
            title="Questions, answered"
            description="A few common questions. More on the FAQ page."
          />
          <dl className="mx-auto mt-10 max-w-3xl space-y-6">
            {[
              {
                q: "When do reservations open?",
                a: "Soon. Join the waitlist to be among the first invited.",
              },
              {
                q: "Is there a deposit?",
                a: "A 50% deposit confirms your seat. Final policy language pending.",
              },
              {
                q: "Can I bring children?",
                a: "Absolutely — Sundays are for all ages. Children's plates available.",
              },
            ].map((f) => (
              <div key={f.q} className="rounded-lg border border-border bg-card p-5">
                <dt className="font-display text-lg font-semibold text-foreground">{f.q}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 text-center">
            <ButtonLink to="/faq" variant="outline">
              Read all FAQs
            </ButtonLink>
          </div>
        </Container>
      </section>

      {/* Waitlist CTA */}
      <section className="bg-clay text-cream">
        <Container className="flex flex-col items-center gap-6 py-20 text-center">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">
            Save your seat at the table
          </h2>
          <p className="max-w-xl text-cream/90">
            The waitlist is the first step. When reservations open, you'll hear from us first.
          </p>
          <ButtonLink to="/waitlist" variant="gold" size="lg">
            Join the Waitlist
          </ButtonLink>
          <Link
            to="/contact"
            className="text-sm text-cream/80 underline underline-offset-2 hover:text-cream"
          >
            Have a question? Contact us
          </Link>
        </Container>
      </section>
    </>
  );
}
