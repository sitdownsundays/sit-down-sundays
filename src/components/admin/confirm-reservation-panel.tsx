/**
 * ConfirmReservationPanel — owns the confirmation lifecycle state that must
 * survive dialog close/reopen: the uncertainty gate (keyed by reservation ID),
 * the awaitable reload (which adopts the exact fetched record into the
 * displayed detail — no second fetch), and the success-feedback/refresh-
 * separation logic.
 *
 * The parent only needs to render this component and pass the reservation to
 * confirm plus the detail-adoption and list-refresh callbacks. All lifecycle
 * state lives here so it is not lost when the dialog closes.
 *
 * Stale-response guard: the panel guards its own reload side effects using a
 * reservation-identity + generation guard. A reload result for a different
 * reservation ID (or after close/unmount/a newer operation) does NOT clear the
 * requested reservation's gate or invoke refresh callbacks.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { getReservationDetail } from "@/lib/reservation.functions";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

import { ConfirmReservationDialog } from "@/components/admin/confirm-reservation-dialog";
import {
  blockGate,
  clearGate,
  createConfirmGate,
  isGateBlocked,
} from "@/components/admin/confirm-reservation-controller";
import type { ConfirmGateMap } from "@/components/admin/confirm-reservation-controller";
import { assessReloadedReservation } from "@/components/admin/confirm-reservation-helpers";
import type { ConfirmReloadResult } from "@/components/admin/confirm-reservation-helpers";
import {
  beginOperation,
  createOperationGuard,
  invalidateAll,
  isCurrentOperation,
  setActiveReservation,
} from "@/components/admin/confirm-reservation-guard";
import type { OperationGuard } from "@/components/admin/confirm-reservation-guard";
import {
  runPostMutationRefresh,
  type CombinedRefreshResult,
  type RefreshResult,
} from "@/components/admin/refresh-result-helpers";

interface ConfirmReservationPanelProps {
  /** The reservation the user asked to confirm. Null = dialog closed. */
  reservation: ReservationDetailDTO | null;
  /** Close the dialog. */
  onClose: () => void;
  /**
   * Adopt a freshly-fetched reservation detail record into the displayed
   * detail (replaces the record the staff member is viewing). This is the
   * single source of truth — no second fetch is triggered to display it.
   */
  onAdoptDetail: (reservation: ReservationDetailDTO) => void;
  /**
   * Refresh the detail panel after a successful mutation. Returns a typed
   * RefreshResult (success/failure/superseded) so the panel can show a
   * separate refresh error without re-running the mutation and without
   * confusing a superseded refresh with a failure.
   */
  onRefreshDetail: () => Promise<RefreshResult>;
  /**
   * Refresh the reservation list after a successful mutation. Returns a typed
   * RefreshResult.
   */
  onRefreshList: () => Promise<RefreshResult>;
}

export function ConfirmReservationPanel({
  reservation,
  onClose,
  onAdoptDetail,
  onRefreshDetail,
  onRefreshList,
}: ConfirmReservationPanelProps) {
  const getReservationDetailFn = useServerFn(getReservationDetail);

  // Parent-owned uncertainty gate: reservation ID → blocked. Survives close.
  const [confirmGate, setConfirmGate] = useState<ConfirmGateMap>(createConfirmGate);

  // Panel-side operation guard so obsolete reload results cannot clear the
  // requested reservation's gate or trigger refresh callbacks.
  const guardRef = useRef<OperationGuard | null>(null);
  if (guardRef.current === null) guardRef.current = createOperationGuard();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const guard = guardRef.current;
      if (guard) invalidateAll(guard);
    };
  }, []);

  // Track the active reservation for the panel's own reload guard.
  useEffect(() => {
    const guard = guardRef.current!;
    if (reservation) {
      setActiveReservation(guard, reservation.id);
    } else {
      invalidateAll(guard);
    }
  }, [reservation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const gateBlocked = reservation ? isGateBlocked(confirmGate, reservation.id) : false;

  const handleSaved = useCallback(
    async (message: string): Promise<CombinedRefreshResult> => {
      if (reservation) {
        setConfirmGate((prev) => clearGate(prev, reservation.id));
      }
      // Preserve successful mutation feedback separately from refresh failure.
      toast.success(message);
      // Refresh detail + list independently using the shared typed-result
      // orchestrator. A failure in one does not block the other, a superseded
      // refresh is not confused with a failure, and neither invalidates the
      // successful mutation. runPostMutationRefresh never invokes a mutation.
      // The CombinedRefreshResult is returned directly — no boolean
      // conversion that would discard the superseded distinction.
      return runPostMutationRefresh(onRefreshDetail, onRefreshList);
    },
    [reservation, onRefreshDetail, onRefreshList],
  );

  // Block another attempt for this reservation after an uncertain/conflict
  // outcome. Uses the tested blockGate helper so production behavior matches
  // the lifecycle tests.
  const handleRequireReload = useCallback((reservationId: string) => {
    setConfirmGate((prev) => blockGate(prev, reservationId));
  }, []);

  const handleReload = useCallback(async (): Promise<ConfirmReloadResult> => {
    if (!reservation) {
      return { success: false, reservation: null, error: "No reservation selected." };
    }
    const guard = guardRef.current!;
    const requestedId = reservation.id;
    // Begin a panel-side operation so we can reject stale reload results.
    const snapshot = beginOperation(guard, requestedId);

    try {
      const res = await getReservationDetailFn({ data: { id: requestedId } });

      // Reject obsolete reload results: unmount, reservation change, close, or
      // a newer operation. A result for a different reservation must NOT clear
      // the requested reservation's gate or invoke refresh callbacks.
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) {
        return { success: false, reservation: null, error: "Reload superseded." };
      }

      if (!res.ok) {
        // Discriminated-union failure branch: res.error is valid here.
        return {
          success: false,
          reservation: null,
          error: res.error ?? "Could not reload the reservation.",
        };
      }

      // Success branch: res.reservation is the required fetched record.
      if (res.reservation.id !== requestedId) {
        // Wrong reservation — do not clear the gate or refresh.
        return { success: false, reservation: null, error: "Could not reload the reservation." };
      }
      // Adopt the exact fetched record into the displayed detail. No second
      // fetch is triggered — this record IS the new displayed detail.
      onAdoptDetail(res.reservation);
      const assessment = assessReloadedReservation(res.reservation);
      if (assessment.kind === "confirmable") {
        // Clear the gate ONLY after the fresh pending_review details are
        // adopted. The dialog stays open with the fresh timestamp.
        setConfirmGate((prev) => clearGate(prev, requestedId));
      } else {
        // confirmed / inapplicable — keep the gate blocked; no mutation.
        setConfirmGate((prev) => blockGate(prev, requestedId));
      }
      return { success: true, reservation: res.reservation };
    } catch {
      return { success: false, reservation: null, error: "Could not reload the reservation." };
    }
  }, [reservation, getReservationDetailFn, onAdoptDetail]);

  return (
    <ConfirmReservationDialog
      reservation={reservation}
      gateBlocked={gateBlocked}
      onSaved={handleSaved}
      onClose={onClose}
      onReload={handleReload}
      onRequireReload={handleRequireReload}
    />
  );
}
