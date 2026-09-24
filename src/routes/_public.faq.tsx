import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/layout/button-link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/_public/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — Sit Down Sundays" },
      {
        name: "description",
        content:
          "Frequently asked questions about Sit Down Sundays — waitlist, deposits, seating, and more.",
      },
      { property: "og:title", content: "FAQ — Sit Down Sundays" },
      { property: "og:description", content: "Frequently asked questions about Sit Down Sundays." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FaqPage,
});

const FAQS = [
  {
    q: "When do reservations open?",
    a: "Soon. Joining the waitlist is the best way to be among the first invited. Final dates pending.",
  },
  {
    q: "Is there a deposit?",
    a: "A 50% deposit confirms your reservation. Final policy language will be published before opening.",
  },
  {
    q: "Can I bring children?",
    a: "Yes — Sundays are for all ages. Children's plates are available on the menu.",
  },
  {
    q: "What is the private room?",
    a: "A dedicated space for larger parties, with its own fee and capacity. See the Private Room page.",
  },
  {
    q: "Can I change or cancel my reservation?",
    a: "Transfer and cancellation processes will be outlined in our policies before opening.",
  },
  {
    q: "Do you accommodate dietary needs?",
    a: "Yes. You'll be able to note dietary and allergy information during booking.",
  },
];

function FaqPage() {
  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="FAQ"
        title="Frequently asked questions"
        description="Provisional answers — finalized before opening."
      />
      <Accordion type="single" collapsible className="mt-10">
        {FAQS.map((f, i) => (
          <AccordionItem key={f.q} value={`item-${i}`}>
            <AccordionTrigger className="text-left font-display text-lg text-foreground">
              {f.q}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
        <ButtonLink to="/contact" variant="outline">
          Still have questions?
        </ButtonLink>
      </div>
    </Container>
  );
}
