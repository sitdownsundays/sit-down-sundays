import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface SectionHeadingProps {
  title: string;
  /** Optional small label rendered above the title. */
  eyebrow?: string;
  description?: string;
  centered?: boolean;
  className?: string;
  children?: ReactNode;
}

export function SectionHeading({
  title,
  eyebrow,
  description,
  centered,
  className,
  children,
}: SectionHeadingProps) {
  return (
    <div className={cn("space-y-3", centered && "text-center", className)}>
      {eyebrow && (
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
      )}
      <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">{title}</h2>
      {description && (
        <p className={cn("text-base text-muted-foreground", centered && "mx-auto max-w-2xl")}>
          {description}
        </p>
      )}
      {children}
    </div>
  );
}
