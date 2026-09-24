import { createFileRoute } from "@tanstack/react-router";
import {
  SimplePlaceholderPage,
  WaitlistCtaFooter,
} from "@/components/layout/simple-placeholder-page";

export const Route = createFileRoute("/_public/policies")({
  head: () => ({
    meta: [
      { title: "Policies — Sit Down Sundays" },
      {
        name: "description",
        content:
          "Sit Down Sundays policies — deposits, cancellations, and transfers. Final language pending.",
      },
      { property: "og:title", content: "Policies — Sit Down Sundays" },
      { property: "og:description", content: "Sit Down Sundays policies. Final language pending." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PoliciesPage,
});

function PoliciesPage() {
  return (
    <SimplePlaceholderPage
      eyebrow="Policies"
      title="Our Policies"
      description="Deposit, cancellation, transfer, and refund policies. Provisional — final language published before opening."
      placeholderTitle="Policies in preparation"
      placeholderDescription="Final policy language for deposits, cancellations, transfers, and refunds will appear here before reservations open."
    >
      <WaitlistCtaFooter />
    </SimplePlaceholderPage>
  );
}
