import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PlaceholderPanelProps {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Clearly labeled placeholder screen content. Used for Phase 1 screens
 * whose real functionality arrives in later phases.
 */
export function PlaceholderPanel({
  title,
  description,
  children,
  className,
}: PlaceholderPanelProps) {
  return (
    <div className={cn("rounded-lg border border-dashed border-border bg-card p-6", className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Placeholder
          </p>
          <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
