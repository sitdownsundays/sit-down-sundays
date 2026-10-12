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
 *
 * The ReservationDetail presentation component and its label helpers were
 * extracted to @/components/admin/reservation-detail for file-size
 * reorganization. Behavior is unchanged.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Search, X } from "lucide-react";

import { getReservationDetail, listReservations } from "@/lib/reservation.functions";
import type { ReservationDetailDTO, ReservationListItemDTO } from "@/lib/reservation/types";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/layout/status-badge";
import { AssignTablesDialog } from "@/components/admin/assign-tables-dialog";
import { CancelReservationPanel } from "@/components/admin/cancel-reservation-panel";
import { ConfirmReservationPanel } from "@/components/admin/confirm-reservation-panel";
import { ApprovalReservationDialog } from "@/components/admin/approval-reservation-dialog";
import {
  createApprovalGate,
  blockGate,
  clearGate,
  isGateBlocked,
  applyReloadToGate,
  type ApprovalGateMap,
} from "@/components/admin/approval-reservation-controller";
import {
  assessReloadResponse,
  type ApprovalReloadResult,
} from "@/components/admin/approval-reservation-helpers";
import { toast } from "sonner";
import { formatCurrency } from "@/components/layout/currency-display";
import {
  ReservationDetail,
  paymentLabel,
  paymentTone,
  statusLabel,
  statusTone,
} from "@/components/admin/reservation-detail";
import {
  REFRESH_SUCCESS,
  refreshFailure,
  refreshSuperseded,
  type RefreshResult,
  type CombinedRefreshResult,
} from "@/components/admin/refresh-result-helpers";

/* ----------------------------- Status filters ----------------------------- */

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "pending_review", label: "Pending Review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "balance_due", label: "Balance Due" },
  { value: "paid_in_full", label: "Paid In Full" },
  { value: "cancelled", label: "Cancelled" },
];

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
  const [approvalReservation, setApprovalReservation] = useState<ReservationDetailDTO | null>(null);
  const [approvalGate, setApprovalGate] = useState<ApprovalGateMap>({});

  const listGenRef = useRef(0);
  const detailGenRef = useRef(0);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const reload = useCallback(async (): Promise<RefreshResult> => {
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
      if (gen !== listGenRef.current) return refreshSuperseded();
      if (res.ok) {
        setReservations(res.reservations);
        setLoadState("loaded");
        return REFRESH_SUCCESS;
      } else {
        setLoadError(res.error);
        setLoadState("error");
        return refreshFailure(res.error);
      }
    } catch {
      if (gen !== listGenRef.current) return refreshSuperseded();
      setLoadError("Reservations could not be loaded.");
      setLoadState("error");
      return refreshFailure("Reservations could not be loaded.");
    }
  }, [listReservationsFn, statusFilter, debouncedSearch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openDetail = useCallback(
    async (id: string): Promise<RefreshResult> => {
      const gen = ++detailGenRef.current;
      setSelectedId(id);
      setDetail(null);
      setDetailState("loading");
      setDetailError("");
      try {
        const res = await getReservationDetailFn({ data: { id } });
        if (gen !== detailGenRef.current) return refreshSuperseded();
        if (res.ok) {
          setDetail(res.reservation);
          setDetailState("loaded");
          return REFRESH_SUCCESS;
        } else {
          setDetailError(res.error);
          setDetailState("error");
          return refreshFailure(res.error);
        }
      } catch {
        if (gen !== detailGenRef.current) return refreshSuperseded();
        setDetailError("This reservation could not be loaded.");
        setDetailState("error");
        return refreshFailure("This reservation could not be loaded.");
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

  /* -------- Approval: reload + save callbacks -------- */
  const reloadApprovalReservation = useCallback(async (): Promise<ApprovalReloadResult> => {
    if (!selectedId)
      return { success: false, reservation: null, error: "No reservation selected." };
    const gen = ++detailGenRef.current;
    try {
      const res = await getReservationDetailFn({ data: { id: selectedId } });
      if (gen !== detailGenRef.current) {
        return { success: false, reservation: null, error: "A newer request is in progress." };
      }
      // Discriminate the endpoint's { ok, reservation? } contract via the
      // extracted helper. The caller still owns generation/identity guards;
      // a stale or failed response never adopts state or clears the gate.
      const reloadResult = assessReloadResponse(res);
      if (reloadResult.success && reloadResult.reservation) {
        setDetail(reloadResult.reservation);
        setApprovalReservation(reloadResult.reservation);
        setApprovalGate((g) => applyReloadToGate(g, reloadResult).gate);
      }
      return reloadResult;
    } catch {
      return { success: false, reservation: null, error: "Could not reload the reservation." };
    }
  }, [selectedId, getReservationDetailFn]);

  const handleApprovalSaved = useCallback(
    async (message: string): Promise<CombinedRefreshResult> => {
      if (selectedId) setApprovalGate((g) => clearGate(g, selectedId));
      toast.success(message);
      const detailResult = selectedId ? await openDetail(selectedId) : refreshSuperseded();
      const listResult = await reload();
      return { detail: detailResult, list: listResult };
    },
    [selectedId, openDetail, reload],
  );

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
            onApproveForPayment={() => setApprovalReservation(detail)}
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
        <CancelReservationPanel
          reservation={cancelReservation}
          onClose={() => setCancelReservation(null)}
          onAdoptDetail={(fresh) => {
            setDetail(fresh);
            setCancelReservation(fresh);
          }}
          onRefreshDetail={async () => {
            if (!selectedId) return refreshSuperseded();
            return openDetail(selectedId);
          }}
          onRefreshList={() => reload()}
        />
        <ConfirmReservationPanel
          reservation={confirmReservationState}
          onClose={() => setConfirmReservationState(null)}
          onAdoptDetail={(fresh) => {
            // Adopt the exact fetched record into the displayed detail — no
            // second fetch. Update the confirmation dialog state too so it
            // shows the fresh record/timestamp.
            setDetail(fresh);
            setConfirmReservationState(fresh);
          }}
          onRefreshDetail={async () => {
            if (!selectedId) return refreshSuperseded();
            return openDetail(selectedId);
          }}
          onRefreshList={() => reload()}
        />
        <ApprovalReservationDialog
          reservation={approvalReservation}
          onSaved={handleApprovalSaved}
          onClose={() => setApprovalReservation(null)}
          onReload={reloadApprovalReservation}
          gateBlocked={
            approvalReservation ? isGateBlocked(approvalGate, approvalReservation.id) : false
          }
          onRequireReload={(id) => setApprovalGate((g) => blockGate(g, id))}
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
