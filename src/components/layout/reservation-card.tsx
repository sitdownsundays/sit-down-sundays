import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";
import { CurrencyDisplay } from "./currency-display";
import { RESERVATION_STATUS_LABELS, RESERVATION_STATUS_TONE } from "@/lib/domain/statuses";
import type { Reservation } from "@/lib/domain/types";

interface ReservationCardProps {
  reservation: Reservation;
  to: string;
  className?: string;
}

export function ReservationCard({ reservation, to, className }: ReservationCardProps) {
  return (
    <Link
      to={to as never}
      params={{ reservationId: reservation.id } as never}
      className={cn(
        "block rounded-lg border border-border bg-card p-5 transition-colors hover:border-clay/50 hover:bg-accent/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-foreground">
            {reservation.confirmationNumber}
          </p>
          <p className="text-sm text-muted-foreground">Party of {reservation.partySize}</p>
        </div>
        <StatusBadge tone={RESERVATION_STATUS_TONE[reservation.status]}>
          {RESERVATION_STATUS_LABELS[reservation.status]}
        </StatusBadge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Deposit</dt>
          <dd className="font-medium">
            <CurrencyDisplay cents={reservation.pricing.depositRequiredCents} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Balance</dt>
          <dd className="font-medium">
            <CurrencyDisplay cents={reservation.remainingBalanceCents} />
          </dd>
        </div>
      </dl>
    </Link>
  );
}
