/**
 * Admin Reservations — list + detail (read-only).
 *
 * Phase: request-only reservations. This screen is READ-ONLY:
 *  - No confirm/cancel/check-in/payment/table-assignment mutations.
 *  - No mock fallback when Supabase fails.
 *  - No direct browser database access.
 *
 * Authorization is enforced server-side by the listReservations /
 * getReservationDetail server functions (resolveReservationStaffActor →
 * reservations.read_all). This UI only gates presentation.
 *
 * Stale-response protection: a request-generation counter guards both the
 * list and the detail fetch so an older async response cannot overwrite a
 * newer selection or filter set.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, RefreshCw, Search, X } from "lucide-react";

import { getReservationDetail, listReservations } from "@/lib/reservation.functions";
import type { ReservationDetailDTO, ReservationListItemDTO } from "@/lib/reservation/types";
import type {
  PaymentStatus as DomainPaymentStatus,
  ReservationStatus as DomainReservationStatus,
} from "@/lib/domain/types";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/layout/status-badge";
import { GuestDietaryNeeds } from "@/components/admin/guest-dietary-needs";
import { PartyFeastSummary } from "@/components/admin/party-feast-summary";
import { AssignTablesDialog } from "@/components/admin/assign-tables-dialog";
import { CancelReservationDialog } from "@/components/admin/cancel-reservation-dialog";
import { isCancellableStatus } from "@/components/admin/cancel-reservation-helpers";
import { ConfirmReservationDialog } from "@/components/admin/confirm-reservation-dialog";
import { isConfirmableStatus } from "@/components/admin/confirm-reservation-helpers";
import { CurrencyDisplay, formatCurrency } from "@/components/layout/currency-display";
import { PermissionGate } from "@/components/layout/permission-gate";
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONE,
} from "@/lib/domain/statuses";

/* ----------------------------- Status filters ----------------------------- */

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "pending_review", label: "Pending Review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "balance_due", label: "Balance Due" },
  { value: "paid_in_full", label: "Paid in Full" },
  { value: "cancelled", label: "Cancelled" },
];

function statusLabel(s: string): string {
  if (s === "pending_review") return "Pending review";
  return RESERVATION_STATUS_LABELS[s as DomainReservationStatus] ?? s;
}
function statusTone(s: string) {
  return RESERVATION_STATUS_TONE[s as DomainReservationStatus] ?? "neutral";
}
function paymentLabel(s: string): string {
  return PAYMENT_STATUS_LABELS[s as DomainPaymentStatus] ?? s;
}
function paymentTone(s: string) {
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

function ReservationDetail({
  reservation,
  onBack,
  onAssignTables,
  onCancel,
  onConfirm,
}: {
  reservation: ReservationDetailDTO;
  onBack: () => void;
  onAssignTables: () => void;
  onCancel: () => void;
  onConfirm: () => void;
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

/* ----------------------------- List view ----------------------------- */

type LoadState = "loading" | "loaded" | "error";

export function AdminReservationsPage() {
  const listReservationsFn = useServerFn(listReservations);
  const getReservationDetailFn = useServerFn(getReservationDetail);

  const [reservations, setReservations] = useState<ReservationListItemDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReservationDetailDTO | null>(null);
  const [detailState, setDetailState] = useState<LoadState>("loading");
  const [detailError, setDetailError] = useState("");
  const [assignTablesId, setAssignTablesId] = useState<string | null>(null);
  const [cancelReservation, setCancelReservation] = useState<ReservationDetailDTO | null>(null);
  const [confirmReservationState, setConfirmReservationState] =
    useState<ReservationDetailDTO | null>(null);

  const listGenRef = useRef(0);
  const detailGenRef = useRef(0);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const reload = useCallback(async () => {
    const gen = ++listGenRef.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const res = await listReservationsFn({
        data: {
          status: statusFilter === "all" ? undefined : statusFilter,
          search: debouncedSearch || undefined,
        },
      });
      // Stale-response guard: ignore if a newer request started.
      if (gen !== listGenRef.current) return;
      if (res.ok) {
        setReservations(res.reservations);
        setLoadState("loaded");
      } else {
        setLoadError(res.error);
        setLoadState("error");
      }
    } catch {
      if (gen !== listGenRef.current) return;
      setLoadError("Reservations could not be loaded.");
      setLoadState("error");
    }
  }, [listReservationsFn, statusFilter, debouncedSearch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openDetail = useCallback(
    async (id: string) => {
      const gen = ++detailGenRef.current;
      setSelectedId(id);
      setDetail(null);
      setDetailState("loading");
      setDetailError("");
      try {
        const res = await getReservationDetailFn({ data: { id } });
        if (gen !== detailGenRef.current) return;
        if (res.ok) {
          setDetail(res.reservation);
          setDetailState("loaded");
        } else {
          setDetailError(res.error);
          setDetailState("error");
        }
      } catch {
        if (gen !== detailGenRef.current) return;
        setDetailError("This reservation could not be loaded.");
        setDetailState("error");
      }
    },
    [getReservationDetailFn],
  );

  const closeDetail = useCallback(() => {
    detailGenRef.current++; // invalidate any in-flight detail fetch
    setSelectedId(null);
    setDetail(null);
    setDetailState("loading");
    setDetailError("");
  }, []);

  /* ---------------- Detail panel ---------------- */
  if (selectedId) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Administration"
          title="Reservation details"
          description="Read-only view of a submitted reservation request."
        />
        {detailState === "loading" && <LoadingState label="Loading reservation…" />}
        {detailState === "error" && (
          <ErrorState
            title="Reservation could not be loaded"
            message={detailError || "Please try again."}
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void openDetail(selectedId)}>
                  <RefreshCw className="size-4" aria-hidden />
                  Try again
                </Button>
                <Button variant="ghost" onClick={closeDetail}>
                  Back to list
                </Button>
              </div>
            }
          />
        )}
        {detailState === "loaded" && detail && (
          <ReservationDetail
            reservation={detail}
            onBack={closeDetail}
            onAssignTables={() => setAssignTablesId(selectedId)}
            onCancel={() => setCancelReservation(detail)}
            onConfirm={() => setConfirmReservationState(detail)}
          />
        )}
        <AssignTablesDialog
          reservationId={assignTablesId}
          onSaved={() => {
            setAssignTablesId(null);
            if (selectedId) void openDetail(selectedId);
          }}
          onClose={() => setAssignTablesId(null)}
        />
        <CancelReservationDialog
          reservation={cancelReservation}
          onSaved={() => {
            if (selectedId) void openDetail(selectedId);
            void reload();
          }}
          onClose={() => setCancelReservation(null)}
          onReload={() => {
            if (selectedId) void openDetail(selectedId);
            void reload();
          }}
        />
        <ConfirmReservationDialog
          reservation={confirmReservationState}
          onSaved={() => {
            if (selectedId) void openDetail(selectedId);
            void reload();
          }}
          onClose={() => setConfirmReservationState(null)}
          onReload={() => {
            if (selectedId) void openDetail(selectedId);
            void reload();
          }}
        />
      </div>
    );
  }

  /* ---------------- List ---------------- */
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Reservations"
        description="Review submitted reservation requests. Requests are not confirmed bookings."
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Status filters"
        >
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label="All"
          />
          {STATUS_FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              active={statusFilter === f.value}
              onClick={() => setStatusFilter(f.value)}
              label={f.label}
            />
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <label className="sr-only" htmlFor="reservation-search">
            Search reservations
          </label>
          <Input
            id="reservation-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number or name…"
            className="pl-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Clear search"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <section aria-label="Reservation list" aria-live="polite">
        {loadState === "loading" && <LoadingState label="Loading reservations…" />}

        {loadState === "error" && (
          <ErrorState
            title="Reservations could not be loaded"
            message={loadError || "Please try again."}
            action={
              <Button variant="outline" onClick={() => void reload()}>
                <RefreshCw className="size-4" aria-hidden />
                Try again
              </Button>
            }
          />
        )}

        {loadState === "loaded" && reservations.length === 0 && (
          <EmptyState
            title="No reservations found"
            description={
              debouncedSearch || statusFilter !== "all"
                ? "No reservations match your filters."
                : "Reservation requests will appear here once guests submit them."
            }
          />
        )}

        {loadState === "loaded" && reservations.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-lg border border-border md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Number
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Customer
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Party
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Date / time
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Payment
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Balance
                    </th>
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reservations.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/40">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {r.reservationNumber}
                      </td>
                      <td className="px-4 py-3 text-foreground">{r.contactName}</td>
                      <td className="px-4 py-3 text-foreground">{r.partySize}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.serviceDate} · {r.seatingStartTime}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={statusTone(r.status)}>
                          {statusLabel(r.status)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={paymentTone(r.paymentStatus)}>
                          {paymentLabel(r.paymentStatus)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {formatCurrency(r.remainingBalanceCents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => void openDetail(r.id)}>
                          View details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {reservations.map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-foreground">{r.reservationNumber}</p>
                    <Button variant="outline" size="sm" onClick={() => void openDetail(r.id)}>
                      View
                    </Button>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{r.contactName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.serviceDate} · {r.seatingStartTime} · {r.partySize} guests
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                    <StatusBadge tone={paymentTone(r.paymentStatus)}>
                      {paymentLabel(r.paymentStatus)}
                    </StatusBadge>
                    <span className="ml-auto text-sm tabular-nums text-foreground">
                      {formatCurrency(r.remainingBalanceCents)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ----------------------------- Local filter chip ----------------------------- */

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      {label}
    </button>
  );
}
