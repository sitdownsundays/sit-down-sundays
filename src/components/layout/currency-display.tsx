import { cn } from "@/lib/utils";

interface CurrencyDisplayProps {
  cents: number;
  currency?: string;
  className?: string;
}

export function formatCurrency(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function CurrencyDisplay({ cents, currency = "USD", className }: CurrencyDisplayProps) {
  return <span className={cn("tabular-nums", className)}>{formatCurrency(cents, currency)}</span>;
}
