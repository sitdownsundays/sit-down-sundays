import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/layout/button-link";

export const Route = createFileRoute("/_public/how-it-works")({
  head: () => ({
    meta: [
      { title: "How It Works — Sit Down Sundays" },
      {
        name: "description",
        content: "From waitlist to table — how a Sit Down Sundays reservation comes together.",
      },
      { property: "og:title", content: "How It Works — Sit Down Sundays" },
      {
        property: "og:description",
        content: "From waitlist to table — how a reservation comes together.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  const steps = [
    {
      title: "Join the waitlist",
      body: "Add your name and party size. You'll hear from us when reservations open.",
    },
    {
      title: "Create an account",
      body: "When invited, set up your guest account to begin booking.",
    },
    { title: "Choose a Sunday", body: "Pick an available Sunday service from the calendar." },
    {
      title: "Select a seating time",
      body: "Choose an early or late seating, subject to availability.",
    },
    {
      title: "Enter your party",
      body: "Tell us about your group — adults, children, seniors, and dietary notes.",
    },
    {
      title: "Choose standard or private room",
      body: "Select the experience that fits your gathering.",
    },
    { title: "Select meals", body: "Pick dishes for your party from the menu." },
    {
      title: "Review & pay deposit",
      body: "See an itemized price and pay a 50% deposit to confirm.",
    },
    { title: "Arrive & enjoy", body: "Settle the remaining balance and take your seat." },
  ];

  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="How It Works"
        title="From waitlist to table"
        description="The path to a seat at the Sunday table. Provisional — booking opens soon."
      />
      <ol className="mt-12 space-y-6">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-4 rounded-lg border border-border bg-card p-5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-clay text-cream font-display font-bold">
              {i + 1}
            </span>
            <div>
              <h3 className="font-display text-lg font-semibold text-foreground">{step.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
        <ButtonLink to="/faq" variant="outline">
          Read FAQs
        </ButtonLink>
      </div>
    </Container>
  );
}
