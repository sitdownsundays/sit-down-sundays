import { cn } from "@/lib/utils";

interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div
      className={cn("flex items-center gap-3 text-sm text-muted-foreground", className)}
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block size-4 animate-spin rounded-full border-2 border-muted border-t-clay"
        aria-hidden
      />
      {label}
    </div>
  );
}
