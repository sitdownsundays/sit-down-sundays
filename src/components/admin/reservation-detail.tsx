/**
 * Admin reservation detail — presentation component.
 *
 * Extracted from admin-reservations.tsx for file-size reorganization.
 * Props, permission gates, labels, buttons, and behavior are unchanged.
 */
import { ArrowLeft } from "lucide-react";

import type { ReservationDetailDTO } from "@/lib/reservation/types";
import type {
  PaymentStatus as DomainPaymentStatus,
  ReservationStatus as DomainReservationStatus,
} from "@/lib/domain/types";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/layout/status-badge";
import { CurrencyDisplay } from "@/components/layout/currency-display";
import { PermissionGate } from "@/components/layout/permission-gate";
import { GuestDietaryNeeds } from "@/components/admin/guest-dietary-needs";
import { PartyFeastSummary } from "@/components/admin/party-feast-summary";
import { isCancellableStatus } from "@/components/admin/cancel-reservation-helpers";
import { isConfirmableStatus } from "@/components/admin/confirm-reservation-helpers";
import {
  isAlreadyApproved,
  isApprovalEligible,
} from "@/components/admin/approval-reservation-helpers";
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONE,
} from "@/lib/domain/statuses";

/* ----------------------------- Status / label helpers ----------------------------- */

export function statusLabel(s: string): string {
  if (s === "pending_review") return "Pending review";
  return RESERVATION_STATUS_LABELS[s as DomainReservationStatus] ?? s;
}
export function statusTone(s: string) {
  return RESERVATION_STATUS_TONE[s as DomainReservationStatus] ?? "neutral";
}
export function paymentLabel(s: string): string {
  return PAYMENT_STATUS_LABELS[s as DomainPaymentStatus] ?? s;
}
export function paymentTone(s: string) {
  return PAYMENT_STATUS_TONE[s as DomainPaymentStatus] ?? "neutral";
}

function formatDateLabel(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ----------------------------- Detail view ----------------------------- */

export function ReservationDetail({
  reservation,
  onBack,
  onAssignTables,
  onCancel,
  onConfirm,
  onApproveForPayment,
}: {
  reservation: ReservationDetailDTO;
  onBack: () => void;
  onAssignTables: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onApproveForPayment: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack} size="sm">
          <ArrowLeft className="size-4" aria-hidden />
          Back to list
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <PermissionGate permission="seating.manage">
            <Button variant="default" onClick={onAssignTables} size="sm">
              Assign tables
            </Button>
          </PermissionGate>
          <PermissionGate permission="reservations.manage">
            {isConfirmableStatus(reservation.status) && (
              <Button variant="default" onClick={onConfirm} size="sm">
                Confirm reservation
              </Button>
            )}
          </PermissionGate>
          <PermissionGate permission="reservations.manage">
            {isApprovalEligible(reservation) && (
              <Button variant="default" onClick={onApproveForPayment} size="sm">
                Approve for deposit payment
              </Button>
            )}
          </PermissionGate>
          <PermissionGate permission="reservations.manage">
            {isAlreadyApproved(reservation) && (
              <span className="text-sm font-medium text-muted-foreground">
                Approved for deposit payment
              </span>
            )}
          </PermissionGate>
          <PermissionGate permission="reservations.manage">
            {isCancellableStatus(reservation.status) && (
              <Button variant="destructive" onClick={onCancel} size="sm">
                Cancel reservation
              </Button>
            )}
          </PermissionGate>
          <StatusBadge tone={statusTone(reservation.status)}>
            {statusLabel(reservation.status)}
          </StatusBadge>
          <StatusBadge tone={paymentTone(reservation.paymentStatus)}>
            {paymentLabel(reservation.paymentStatus)}
          </StatusBadge>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Reservation
            </p>
            <p className="font-display text-2xl font-bold text-foreground">
              {reservation.reservationNumber}
            </p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>Submitted {formatDateLabel(reservation.createdAt)}</p>
            <p>Updated {formatDateLabel(reservation.updatedAt)}</p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Contact name">
            {reservation.contactFirstName} {reservation.contactLastName}
          </Field>
          <Field label="Email">{reservation.contactEmail}</Field>
          <Field label="Phone">{reservation.contactPhone}</Field>
          <Field label="Service date">{reservation.serviceDate}</Field>
          <Field label="Seating">
            {reservation.seatingStartTime}–{reservation.seatingEndTime}
          </Field>
          <Field label="Room">{reservation.spaceName}</Field>
          <Field label="Party size">{reservation.partySize}</Field>
          <Field label="Adults / Seniors / Children">
            {reservation.adults} / {reservation.seniors} / {reservation.children}
          </Field>
          <Field label="Experience">
            {reservation.experienceType === "private_room" ? "Private room" : "Standard"}
          </Field>
        </dl>
      </div>

      {/* Guest dietary needs — personal notes within one party order */}
      <GuestDietaryNeeds guests={reservation.guests} />

      {/* Party-level notes & requests (separate from per-guest) */}
      {(reservation.dietaryNotes ||
        reservation.accessibilityRequests ||
        reservation.guestNotes ||
        reservation.occasion) && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Party notes &amp; requests
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Requests are not guarantees. Staff review each reservation.
          </p>
          <div className="mt-4 space-y-3">
            {reservation.dietaryNotes && (
              <NoteBlock label="Dietary / allergy" text={reservation.dietaryNotes} />
            )}
            {reservation.accessibilityRequests && (
              <NoteBlock label="Accessibility" text={reservation.accessibilityRequests} />
            )}
            {reservation.occasion && <NoteBlock label="Occasion" text={reservation.occasion} />}
            {reservation.guestNotes && (
              <NoteBlock label="General notes" text={reservation.guestNotes} />
            )}
          </div>
        </div>
      )}

      {/* Meal summary — shared feast or guest-level breakdown */}
      <PartyFeastSummary guests={reservation.guests} />

      {/* Shared platters */}
      {reservation.platters.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold text-foreground">Shared platters</h3>
          <ul className="mt-4 space-y-2 text-sm">
            {reservation.platters.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {p.platterNameSnapshot} × {p.quantity}
                </span>
                <CurrencyDisplay cents={p.pricePerPlatterSnapshot * p.quantity} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pricing & payment snapshot */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg font-semibold text-foreground">Pricing & payment</h3>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Subtotal">
            <CurrencyDisplay cents={reservation.subtotalCents} />
          </Row>
          <Row label="Deposit required">
            <CurrencyDisplay cents={reservation.depositRequiredCents} />
          </Row>
          <Row label="Grand total">
            <CurrencyDisplay cents={reservation.grandTotalCents} />
          </Row>
          <Row label="Amount paid">
            <CurrencyDisplay cents={reservation.amountPaidCents} />
          </Row>
          <Row label="Remaining balance">
            <CurrencyDisplay cents={reservation.remainingBalanceCents} />
          </Row>
          <Row label="Balance deadline">
            {reservation.balanceDeadline ? formatDateLabel(reservation.balanceDeadline) : "—"}
          </Row>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          These are saved snapshots of the agreed terms at submission. No payment has been collected
          in this phase.
        </p>
      </div>

      {reservation.internalNotes && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold text-foreground">Internal notes</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
            {reservation.internalNotes}
          </p>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Local presentation helpers ----------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-md bg-accent/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{text}</p>
    </div>
  );
}
