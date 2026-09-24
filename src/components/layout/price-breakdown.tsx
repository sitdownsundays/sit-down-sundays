import { cn } from "@/lib/utils";
import { CurrencyDisplay } from "./currency-display";

interface PriceLine {
  label: string;
  cents: number;
  emphasis?: boolean;
  muted?: boolean;
}

interface PriceBreakdownProps {
  lines: PriceLine[];
  currency?: string;
  className?: string;
}

export function PriceBreakdown({ lines, currency = "USD", className }: PriceBreakdownProps) {
  return (
    <dl className={cn("space-y-2 rounded-lg border border-border bg-card p-5 text-sm", className)}>
      {lines.map((line) => (
        <div
          key={line.label}
          className={cn(
            "flex items-center justify-between",
            line.emphasis && "border-t border-border pt-2 font-semibold",
          )}
        >
          <dt className={cn(line.muted && "text-muted-foreground")}>{line.label}</dt>
          <dd className={cn("tabular-nums", line.muted && "text-muted-foreground")}>
            <CurrencyDisplay cents={line.cents} currency={currency} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
