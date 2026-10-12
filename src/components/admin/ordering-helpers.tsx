/**
 * Admin ordering — shared form helpers and primitives.
 * Used by the package, add-on, platter, and rules dialogs.
 */
import { Label } from "@/components/ui/label";

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function dollarsToCents(dollars: string): number {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

export function Field({
  label,
  error,
  id,
  children,
}: {
  label: string;
  error?: string | undefined;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
