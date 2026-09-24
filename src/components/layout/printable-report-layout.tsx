import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PrintableReportLayoutProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PrintableReportLayout({
  title,
  meta,
  children,
  className,
}: PrintableReportLayoutProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-8 print:border-0 print:shadow-none",
        className,
      )}
    >
      <header className="mb-6 border-b border-border pb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">{title}</h1>
        {meta && <div className="mt-2 text-sm text-muted-foreground">{meta}</div>}
      </header>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
