import { PageHeader } from "@/components/layout/page-header";
import { PlaceholderPanel } from "@/components/layout/placeholder-panel";
import type { ReactNode } from "react";

interface InternalPlaceholderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  placeholderTitle?: string;
  placeholderDescription?: string;
  children?: ReactNode;
}

export function InternalPlaceholder({
  title,
  description,
  eyebrow,
  placeholderTitle,
  placeholderDescription = "This screen is a Phase 1 placeholder. Functionality arrives in a later phase.",
  children,
}: InternalPlaceholderProps) {
  return (
    <div className="space-y-8">
      <PageHeader title={title} description={description} eyebrow={eyebrow} />
      <PlaceholderPanel title={placeholderTitle ?? title} description={placeholderDescription} />
      {children}
    </div>
  );
}
