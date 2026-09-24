import { createFileRoute } from "@tanstack/react-router";
import {
  SimplePlaceholderPage,
  WaitlistCtaFooter,
} from "@/components/layout/simple-placeholder-page";

export const Route = createFileRoute("/_public/our-story")({
  head: () => ({
    meta: [
      { title: "Our Story — Sit Down Sundays" },
      {
        name: "description",
        content:
          "The story behind Sit Down Sundays — a curated Sunday dining experience built around family and shared meals.",
      },
      { property: "og:title", content: "Our Story — Sit Down Sundays" },
      { property: "og:description", content: "The story behind Sit Down Sundays." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OurStoryPage,
});

function OurStoryPage() {
  return (
    <SimplePlaceholderPage
      eyebrow="About"
      title="Our Story"
      description="The heart behind Sit Down Sundays. Provisional narrative — final story coming soon."
      placeholderTitle="Our story is still being written"
      placeholderDescription="We're shaping a tradition around the Sunday table. The full story will appear here as we approach opening."
    >
      <WaitlistCtaFooter />
    </SimplePlaceholderPage>
  );
}
