import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { FormField } from "@/components/layout/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";

export const Route = createFileRoute("/_public/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Sit Down Sundays" },
      {
        name: "description",
        content: "Get in touch with the Sit Down Sundays team with questions or special requests.",
      },
      { property: "og:title", content: "Contact — Sit Down Sundays" },
      { property: "og:description", content: "Get in touch with the Sit Down Sundays team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="Contact"
        title="Get in touch"
        description="Have a question or a special request? Send it our way. Provisional form — not yet connected."
      />
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <FormField label="Name" htmlFor="name" required>
            <Input id="name" placeholder="Your name" />
          </FormField>
          <FormField label="Email" htmlFor="email" required>
            <Input id="email" type="email" placeholder="you@example.com" />
          </FormField>
          <FormField label="Subject" htmlFor="subject">
            <Input id="subject" placeholder="How can we help?" />
          </FormField>
          <FormField label="Message" htmlFor="message" required>
            <Textarea id="message" rows={5} placeholder="Your message" />
          </FormField>
          <Button type="submit">Send message</Button>
        </form>
        <PlaceholderPanel
          title="Contact form is not yet live"
          description="This form is a provisional preview. Submissions are not processed yet. Final contact details will appear here before opening."
        />
      </div>
    </Container>
  );
}
