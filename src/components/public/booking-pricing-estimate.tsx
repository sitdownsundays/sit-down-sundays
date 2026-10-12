/**
 * Booking wizard Step 2 — server-authoritative pricing estimate panel.
 *
 * Displays the quote returned by quoteOrder (the single calculation path).
 * Clearly flags unresolved pricing rules and labels the amount as an
 * ESTIMATE pending final submission revalidation. No payment is collected.
 */
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/layout/loading-state";
import { ErrorState } from "@/components/layout/error-state";
import type { QuoteResult } from "@/lib/public-quote.functions";

interface Props {
  result: QuoteResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PricingEstimatePanel({ result, loading, error, onRetry }: Props) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="font-display text-base font-semibold text-foreground">Pricing estimate</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        This is an estimate. Final pricing is confirmed when you submit your request. No payment is
        collected in this step.
      </p>

      {loading && (
        <div className="mt-4">
          <LoadingState label="Calculating your estimate…" />
        </div>
      )}

      {!loading && error && (
        <div className="mt-4">
          <ErrorState
            title="Couldn't calculate estimate"
            message={error}
            action={
              <Button variant="outline" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && result && !result.ok && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {result.error ?? "We couldn't calculate your estimate."}
        </p>
      )}

      {!loading && !error && result && result.ok && (
        <div className="mt-4 space-y-2">
          {result.lines && result.lines.length > 0 && (
            <ul className="space-y-1 text-sm">
              {result.lines.map((line, i) => (
                <li key={`${line.label}-${i}`} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{line.label}</span>
                  <span className="font-medium text-foreground">
                    {formatCents(line.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result.subtotalCents !== undefined && (
            <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium text-foreground">
                {formatCents(result.subtotalCents)}
              </span>
            </div>
          )}
          {result.grandTotalCents !== undefined && (
            <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
              <span className="font-medium text-foreground">Estimated total</span>
              <span className="font-semibold text-foreground">
                {formatCents(result.grandTotalCents)}
              </span>
            </div>
          )}
          {result.depositRequiredCents !== undefined && result.depositRequiredCents > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Deposit due to reserve</span>
              <span className="font-medium text-foreground">
                {formatCents(result.depositRequiredCents)}
              </span>
            </div>
          )}
          {result.remainingBalanceCents !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Balance due (full, unpaid)</span>
              <span className="text-foreground">{formatCents(result.remainingBalanceCents)}</span>
            </div>
          )}
          {result.projectedBalanceAfterDepositCents !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Projected balance after deposit is paid</span>
              <span className="font-medium text-foreground">
                {formatCents(result.projectedBalanceAfterDepositCents)}
              </span>
            </div>
          )}
          {result.hasUnresolvedRules && result.unresolvedNotes && (
            <div
              className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-foreground"
              role="alert"
            >
              <p className="font-medium">Pricing needs confirmation</p>
              <ul className="mt-1 list-disc pl-4">
                {result.unresolvedNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <p className="mt-1">
                Our team will confirm final pricing before your request is finalized.
              </p>
            </div>
          )}
        </div>
      )}

      {!loading && !error && !result && (
        <p className="mt-4 text-sm text-muted-foreground">
          Complete your meal selections to see a pricing estimate.
        </p>
      )}
    </div>
  );
}
