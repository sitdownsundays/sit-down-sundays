import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ErrorStateProps {
  title?: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center",
        className,
      )}
      role="alert"
    >
      <AlertCircle className="mb-3 size-8 text-destructive" aria-hidden />
      <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
      {message && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
