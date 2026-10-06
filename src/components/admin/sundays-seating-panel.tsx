/**
 * Admin Sundays — seating times panel for a single Sunday service.
 *
 * Loads seating times for the given service, supports create + activate/
 * deactivate, with stale-response and double-submit guards. The service row
 * in the parent table mounts this panel when expanded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Clock } from "lucide-react";

import { listSeatingTimes, createSeatingTime, updateSeatingTime } from "@/lib/sundays.functions";
import type {
  SundayServiceDTO,
  SeatingTimeDTO,
  SeatingTimeOperationResult,
} from "@/lib/sundays/types";
import {
  SERVICE_WINDOW_START,
  SERVICE_WINDOW_END,
  LATEST_RESERVATION_START,
  DINING_DURATION_HOURS,
} from "@/lib/sundays/constants";

import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import { CreateSeatingDialog, type CreateSeatingInput } from "./sundays-create-seating-dialog";

type LoadState = "loading" | "loaded" | "error";

interface SeatingTimesPanelProps {
  service: SundayServiceDTO;
}

export function SeatingTimesPanel({ service }: SeatingTimesPanelProps) {
  const listSeatingFn = useServerFn(listSeatingTimes);
  const createSeatingFn = useServerFn(createSeatingTime);
  const updateSeatingFn = useServerFn(updateSeatingTime);

  const [seatings, setSeatings] = useState<SeatingTimeDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [createOpen, setCreateOpen] = useState(false);
  const actionLockRef = useRef(false);
  const reqGenRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSeatings = useCallback(async () => {
    const gen = ++reqGenRef.current;
    setLoadState("loading");
    try {
      const result = await listSeatingFn({ data: { sundayServiceId: service.id } });
      if (gen !== reqGenRef.current || !mountedRef.current) return; // stale / unmounted guard
      setSeatings(result);
      setLoadState("loaded");
    } catch {
      if (gen !== reqGenRef.current || !mountedRef.current) return;
      setLoadState("error");
    }
  }, [listSeatingFn, service.id]);

  useEffect(() => {
    loadSeatings();
  }, [loadSeatings]);

  async function handleCreate(input: CreateSeatingInput) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    try {
      const result: SeatingTimeOperationResult = await createSeatingFn({
        data: {
          sundayServiceId: service.id,
          label: input.label,
          startTime: input.startTime,
          endTime: input.endTime,
          onlineBookingLimit: input.onlineBookingLimit,
        },
      });
      if (result.success) {
        toast.success("Seating time created.");
        setCreateOpen(false);
        await loadSeatings();
      } else {
        toast.error(result.error ?? "Could not create seating time.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      actionLockRef.current = false;
    }
  }

  async function handleToggleActive(seating: SeatingTimeDTO) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    try {
      const result: SeatingTimeOperationResult = await updateSeatingFn({
        data: {
          id: seating.id,
          expectedUpdatedAt: seating.updatedAt,
          isActive: !seating.isActive,
        },
      });
      if (result.success) {
        toast.success(seating.isActive ? "Seating deactivated." : "Seating activated.");
        await loadSeatings();
      } else if (result.conflict) {
        toast.error("This seating was modified by another user. Reload and try again.");
      } else {
        toast.error(result.error ?? "Could not update seating time.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      actionLockRef.current = false;
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
          <Clock className="size-4" aria-hidden />
          Seating times — {service.date}
        </h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" aria-hidden />
          Add seating
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Start times {SERVICE_WINDOW_START}–{LATEST_RESERVATION_START}. Each seating lasts{" "}
        {DINING_DURATION_HOURS} hours. Service ends at {SERVICE_WINDOW_END}.
      </p>

      {loadState === "loading" && <LoadingState label="Loading seating times…" />}
      {loadState === "error" && (
        <ErrorState message="We couldn't load seating times." onRetry={loadSeatings} />
      )}
      {loadState === "loaded" && seatings.length === 0 && (
        <EmptyState title="No seating times" description="Add a seating time for this service." />
      )}
      {loadState === "loaded" && seatings.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold text-foreground">
                  Label
                </th>
                <th scope="col" className="px-3 py-2 font-semibold text-foreground">
                  Start
                </th>
                <th scope="col" className="px-3 py-2 font-semibold text-foreground">
                  End
                </th>
                <th scope="col" className="px-3 py-2 font-semibold text-foreground">
                  Limit
                </th>
                <th scope="col" className="px-3 py-2 font-semibold text-foreground">
                  Active
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {seatings.map((seating) => (
                <tr key={seating.id} className="bg-card">
                  <td className="px-3 py-2 text-foreground">{seating.label}</td>
                  <td className="px-3 py-2 text-foreground">{seating.startTime}</td>
                  <td className="px-3 py-2 text-foreground">{seating.endTime}</td>
                  <td className="px-3 py-2">
                    {seating.onlineBookingLimit === null ? (
                      <span className="text-muted-foreground">Not set</span>
                    ) : (
                      <span className="text-foreground">{seating.onlineBookingLimit}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {seating.isActive ? (
                      <span className="inline-flex rounded-full bg-sage/15 px-2 py-0.5 text-xs font-medium text-sage">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => handleToggleActive(seating)}>
                      {seating.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateSeatingDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
    </div>
  );
}
