import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";
import { ButtonLink } from "@/components/layout/button-link";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

interface SimplePageProps {
  title: string;
  description?: string;
  eyebrow?: string;
  placeholderTitle: string;
  placeholderDescription?: string;
  children?: ReactNode;
  metaTitle: string;
  metaDescription: string;
}

/**
 * Shared layout for Phase 1 placeholder screens. Clearly labeled.
 */
export function SimplePlaceholderPage({
  title,
  description,
  eyebrow,
  placeholderTitle,
  placeholderDescription,
  children,
}: Omit<SimplePageProps, "metaTitle" | "metaDescription">) {
  return (
    <Container className="py-12">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back home
      </Link>
      <PageHeader title={title} description={description} eyebrow={eyebrow} />
      <div className="mt-8 space-y-6">
        <PlaceholderPanel title={placeholderTitle} description={placeholderDescription} />
        {children}
      </div>
    </Container>
  );
}

export function WaitlistCtaFooter() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-clay/30 bg-clay/5 p-5">
      <p className="flex-1 text-sm text-foreground">
        Reservations aren't open yet — join the waitlist to be first in line.
      </p>
      <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
    </div>
  );
}
