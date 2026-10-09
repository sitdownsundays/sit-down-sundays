/**
 * Assign Tables dialog — party-to-table assignment for a reservation.
 *
 * Loads fresh context when opened, preselects current assignments, enforces
 * capacity and inactive-table guards, and saves through the existing
 * assignReservationTables server function using the context's original
 * updatedAt as expectedUpdatedAt. Stale responses are ignored after close,
 * reservation change, or unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";

import { assignReservationTables, getReservationTableContext } from "@/lib/sundays.functions";
import type {
  AssignTablesResult,
  ReservationTableContextDTO,
  ReservationTableContextResult,
} from "@/lib/sundays/types";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  initialSelectionFromContext,
  guardMessage,
  buildSavePayload,
  buildReleasePayload,
  selectedSeats,
  selectionHasChanges,
  type AssignTablesSelection,
} from "./assign-tables-helpers";

interface AssignTablesDialogProps {
  /** When set, the dialog opens for this reservation ID. */
  reservationId: string | null;
  /** Called after a successful save so the parent refreshes the detail. */
  onSaved: () => void;
  /** Called when the dialog is dismissed (cancel / outside click / escape). */
  onClose: () => void;
}

type LoadState = "loading" | "loaded" | "error";

export function AssignTablesDialog({ reservationId, onSaved, onClose }: AssignTablesDialogProps) {
  const getContextFn = useServerFn(getReservationTableContext);
  const assignFn = useServerFn(assignReservationTables);

  const [context, setContext] = useState<ReservationTableContextDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");

  const [selection, setSelection] = useState<AssignTablesSelection>({ tableIds: [] });
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);

  const submitLockRef = useRef(false);
  const loadGenRef = useRef(0);

  const open = reservationId !== null;

  // Load context fresh whenever the dialog opens for a (different) reservation.
  useEffect(() => {
    if (!reservationId) return;

    const gen = ++loadGenRef.current;
    setLoadState("loading");
    setLoadError("");
    setError("");
    setConflict(false);
    setContext(null);
    setSelection({ tableIds: [] });

    void (async () => {
      const res: ReservationTableContextResult = await getContextFn({
        data: { reservationId },
      });
      // Stale-response guard: ignore if a newer load started or dialog closed.
      if (gen !== loadGenRef.current || !open) return;
      if (res.ok) {
        setContext(res.context);
        setSelection(initialSelectionFromContext(res.context));
        setLoadState("loaded");
      } else {
        setLoadError(res.error);
        setLoadState("error");
      }
    })();
  }, [reservationId, getContextFn, open]);

  // Invalidate any in-flight load on unmount.
  useEffect(() => {
    const gen = loadGenRef.current;
    return () => {
      loadGenRef.current = gen + 1;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!reservationId) return;
    const gen = ++loadGenRef.current;
    setLoadState("loading");
    setLoadError("");
    setError("");
    setConflict(false);
    try {
      const res: ReservationTableContextResult = await getContextFn({
        data: { reservationId },
      });
      if (gen !== loadGenRef.current || !open) return;
      if (res.ok) {
        setContext(res.context);
        setSelection(initialSelectionFromContext(res.context));
        setLoadState("loaded");
      } else {
        setLoadError(res.error);
        setLoadState("error");
      }
    } catch {
      if (gen !== loadGenRef.current) return;
      setLoadError("We couldn't load the table assignment context. Please try again.");
      setLoadState("error");
    }
  }, [reservationId, getContextFn, open]);

  const toggleTable = useCallback(
    (tableId: string) => {
      if (saving || conflict) return;
      setSelection((prev) => {
        if (prev.tableIds.includes(tableId)) {
          return { tableIds: prev.tableIds.filter((id) => id !== tableId) };
        }
        return { tableIds: [...prev.tableIds, tableId] };
      });
      setError("");
    },
    [saving, conflict],
  );

  const guard = context ? guardMessage(context, selection) : null;
  const hasChanges = context ? selectionHasChanges(context, selection) : false;
  const canSave = !!context && hasChanges && !guard && !saving;
  const seats = context ? selectedSeats(context.roomTables, selection) : 0;
  const busy = saving;

  async function handleSave() {
    if (!context || submitLockRef.current) return;
    if (guard || !hasChanges) return;

    submitLockRef.current = true;
    setSaving(true);
    setError("");
    setConflict(false);
    try {
      const payload = buildSavePayload(context, selection);
      const result: AssignTablesResult = await assignFn({ data: payload });
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      if (result.code === "conflict") {
        setConflict(true);
        setError(result.error);
      } else if (result.code === "table_conflict") {
        setError(result.error);
      } else if (result.code === "unexpected") {
        // Uncertain outcome: do not auto-retry. Require reload before another save.
        setConflict(true);
        setError(
          "The outcome could not be confirmed. Reload the current context before trying again.",
        );
      } else {
        setError(result.error);
      }
    } catch {
      setConflict(true);
      setError(
        "The outcome could not be confirmed. Reload the current context before trying again.",
      );
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  }

  async function handleRelease() {
    if (!context || submitLockRef.current) return;
    setShowReleaseConfirm(false);

    submitLockRef.current = true;
    setSaving(true);
    setError("");
    setConflict(false);
    try {
      const payload = buildReleasePayload(context);
      const result: AssignTablesResult = await assignFn({ data: payload });
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      if (result.code === "conflict") {
        setConflict(true);
        setError(result.error);
      } else if (result.code === "unexpected") {
        setConflict(true);
        setError(
          "The outcome could not be confirmed. Reload the current context before trying again.",
        );
      } else {
        setError(result.error);
      }
    } catch {
      setConflict(true);
      setError(
        "The outcome could not be confirmed. Reload the current context before trying again.",
      );
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  }

  async function handleReloadLatest() {
    if (!reservationId || submitLockRef.current) return;
    submitLockRef.current = true;
    setConflict(false);
    setError("");
    setLoadState("loading");
    setLoadError("");
    try {
      const gen = ++loadGenRef.current;
      const res: ReservationTableContextResult = await getContextFn({
        data: { reservationId },
      });
      if (gen !== loadGenRef.current) return;
      if (res.ok) {
        setContext(res.context);
        setSelection(initialSelectionFromContext(res.context));
        setLoadState("loaded");
      } else {
        setLoadError(res.error);
        setLoadState("error");
      }
    } catch {
      setLoadError("We couldn't load the table assignment context. Please try again.");
      setLoadState("error");
    } finally {
      submitLockRef.current = false;
    }
  }

  const hasCurrentAssignments = (context?.currentAssignments.length ?? 0) > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign tables</DialogTitle>
          <DialogDescription>
            Assign physical tables for this party. Tables must be physically arranged together by
            staff. Another party may occupy a table — availability is checked on save.
          </DialogDescription>
        </DialogHeader>

        {loadState === "loading" && (
          <p className="py-4 text-sm text-muted-foreground">Loading table assignment context…</p>
        )}

        {loadState === "error" && (
          <div className="space-y-3 py-2">
            <p role="alert" className="text-sm text-destructive">
              {loadError || "We couldn't load the table assignment context."}
            </p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              <RefreshCw className="size-4" /> Try again
            </Button>
          </div>
        )}

        {loadState === "loaded" && context && (
          <div className="space-y-4 py-2">
            {/* Reservation summary */}
            <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Reservation
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">{context.reservationNumber}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Party size
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">{context.partySize}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Room
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">{context.roomName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Service date
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">{context.serviceDate}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Seating
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {context.seatingStart}–{context.seatingEnd}
                </dd>
              </div>
            </dl>

            {/* Current assignments */}
            {hasCurrentAssignments && (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Currently assigned
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {context.currentAssignments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between">
                      <span className="text-foreground">{a.tableLabel}</span>
                      <span className="text-muted-foreground">
                        {a.tableSeats} seats{a.tableIsActive ? "" : " (inactive)"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Capacity indicator */}
            <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
              <span className="text-muted-foreground">Selected capacity</span>
              <span className="font-medium text-foreground">
                {seats} / {context.partySize} seats
              </span>
            </div>

            {/* Room table list */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Room tables
              </Label>
              {context.roomTables.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No physical tables are configured for this room. A manager must add tables first.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {context.roomTables.map((t) => {
                    const isCurrent = context.currentAssignments.some(
                      (a) => a.diningTableId === t.id,
                    );
                    const checked = selection.tableIds.includes(t.id);
                    const disableNewInactive = !t.isActive && !isCurrent;
                    return (
                      <li
                        key={t.id}
                        className="flex items-center justify-between rounded-md border border-border p-3"
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            id={`tbl-${t.id}`}
                            checked={checked}
                            disabled={busy || disableNewInactive}
                            onCheckedChange={() => toggleTable(t.id)}
                            aria-label={`Select table ${t.label}`}
                          />
                          <div>
                            <Label
                              htmlFor={`tbl-${t.id}`}
                              className="text-sm font-medium text-foreground"
                            >
                              {t.label}
                              {!t.isActive && (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  (inactive)
                                </span>
                              )}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {t.seats} seats
                              {t.zone ? ` · ${t.zone}` : ""}
                            </p>
                          </div>
                        </div>
                        {disableNewInactive && (
                          <span className="text-xs text-muted-foreground">
                            Cannot newly select inactive
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {guard && (
              <p role="alert" className="text-sm text-destructive">
                {guard}
              </p>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            {conflict && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium text-foreground">Reload required</p>
                <p className="mt-1 text-muted-foreground">
                  The reservation or table assignments changed. Reload the latest context before
                  saving again.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void handleReloadLatest()}
                  disabled={busy}
                >
                  <RefreshCw className="size-4" /> Reload latest
                </Button>
              </div>
            )}

            {/* Release-all action with explicit confirmation */}
            {hasCurrentAssignments && (
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Release all tables</p>
                  <p className="text-xs text-muted-foreground">Does not cancel the reservation.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setShowReleaseConfirm(true)}
                >
                  Release all
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {loadState === "loaded" && context && (
            <Button onClick={() => void handleSave()} disabled={!canSave}>
              {saving ? "Saving…" : "Save assignment"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Release-all confirmation */}
      <AlertDialog
        open={showReleaseConfirm}
        onOpenChange={(next) => {
          if (!busy) setShowReleaseConfirm(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release all tables?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all current table assignments for this reservation. The reservation
              itself is not cancelled. A separate save will confirm the release.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRelease()}>
              Yes, release all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
