/**
 * Admin Sundays — create Sunday service dialog.
 *
 * Includes capacity-mode selection for the selected hosting space, loaded
 * from listServiceCapacityOptions. The default sentinel maps to null; a
 * whole-parent UUID is preserved. Options for room A are never submitted
 * for room B — a space change immediately invalidates the previous load.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import type { VenueSpaceDTO } from "@/lib/spaces/types";
import { SUNDAY_STATUS_LABELS, SUNDAY_STATUSES } from "@/lib/sundays/constants";
import { listServiceCapacityOptions } from "@/lib/sundays.functions";
import type { ServiceCapacityOption } from "@/lib/sundays/service-capacity-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { DEFAULT_SENTINEL, selectionToCapacityValue } from "./service-capacity-helpers";

export interface CreateServiceInput {
  date: string;
  label: string;
  spaceId: string;
  status: string;
  onlineBookingLimit: number | null;
  capacityResourceId: string | null;
}

type CapacityLoadState = "idle" | "loading" | "loaded" | "error";

interface CreateServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: VenueSpaceDTO[];
  onCreate: (input: CreateServiceInput) => void;
  saving?: boolean;
}

export function CreateServiceDialog({
  open,
  onOpenChange,
  spaces,
  onCreate,
  saving = false,
}: CreateServiceDialogProps) {
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [status, setStatus] = useState<string>("scheduled");
  const [bookingLimit, setBookingLimit] = useState("");
  const [capacitySelection, setCapacitySelection] = useState<string | null>(null);
  const [capacityOptions, setCapacityOptions] = useState<ServiceCapacityOption[]>([]);
  const [capacityLoadState, setCapacityLoadState] = useState<CapacityLoadState>("idle");

  // Track the space + load generation for stale-response safety.
  const loadedSpaceIdRef = useRef<string | null>(null);
  const loadGenRef = useRef(0);

  const loadCapacityOptions = useServerFn(listServiceCapacityOptions);

  const loadOptionsForSpace = useCallback(
    async (sid: string): Promise<void> => {
      const gen = loadGenRef.current + 1;
      loadGenRef.current = gen;
      loadedSpaceIdRef.current = sid;
      setCapacityLoadState("loading");
      setCapacityOptions([]);
      // Clear any previous whole-parent selection immediately on space change.
      setCapacitySelection(null);
      try {
        const result = await loadCapacityOptions({ data: { spaceId: sid } });
        // Ignore stale responses after a room change, dialog close, or unmount.
        if (loadedSpaceIdRef.current !== sid || loadGenRef.current !== gen) return;
        if (result.ok) {
          setCapacityOptions(result.options);
          // Select the default/null option only after this room's successful load.
          setCapacitySelection(DEFAULT_SENTINEL);
          setCapacityLoadState("loaded");
        } else {
          setCapacityOptions([]);
          setCapacitySelection(null);
          setCapacityLoadState("error");
        }
      } catch {
        if (loadedSpaceIdRef.current !== sid || loadGenRef.current !== gen) return;
        setCapacityOptions([]);
        setCapacitySelection(null);
        setCapacityLoadState("error");
      }
    },
    [loadCapacityOptions],
  );

  // Reset form when the dialog opens; load capacity options for the initial space.
  useEffect(() => {
    if (!open) return;
    setDate("");
    setLabel("");
    setSpaceId(spaces[0]?.id ?? "");
    setStatus("scheduled");
    setBookingLimit("");
    // Invalidate any pending capacity load from a prior open.
    loadGenRef.current += 1;
    setCapacityOptions([]);
    setCapacitySelection(null);
    setCapacityLoadState("idle");
    if (spaces[0]?.id) {
      void loadOptionsForSpace(spaces[0].id);
    } else {
      setCapacityLoadState("loaded");
      setCapacitySelection(DEFAULT_SENTINEL);
      setCapacityOptions([]);
    }
    return () => {
      // Invalidate pending operations on close/unmount.
      loadGenRef.current += 1;
      loadedSpaceIdRef.current = null;
    };
  }, [open, spaces, loadOptionsForSpace]);

  // When the hosting space changes, immediately invalidate the previous room's
  // choices and load the new room's options. Options for room A must never be
  // submitted for room B.
  function handleSpaceChange(newSpaceId: string) {
    setSpaceId(newSpaceId);
    if (newSpaceId) {
      void loadOptionsForSpace(newSpaceId);
    } else {
      loadGenRef.current += 1;
      loadedSpaceIdRef.current = null;
      setCapacityOptions([]);
      setCapacitySelection(null);
      setCapacityLoadState("idle");
    }
  }

  function handleRetryCapacity() {
    if (spaceId) void loadOptionsForSpace(spaceId);
  }

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const spaceValid = spaceId.length > 0;
  const limitNum = bookingLimit.trim() === "" ? null : Number(bookingLimit);
  const limitValid = limitNum === null || (Number.isInteger(limitNum) && limitNum >= 0);
  // Capacity must be successfully loaded for the CURRENT space, and the
  // selected value must belong to those loaded options. Do not treat
  // loading/error/missing choices as permission to submit null.
  const capacityValid =
    capacityLoadState === "loaded" &&
    capacitySelection !== null &&
    capacityOptions.some(
      (opt) => opt.capacityResourceId === selectionToCapacityValue(capacitySelection),
    );
  const formValid = dateValid && spaceValid && limitValid && capacityValid;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid || saving) return;
    onCreate({
      date,
      label: label.trim(),
      spaceId,
      status,
      onlineBookingLimit: limitNum,
      capacityResourceId: selectionToCapacityValue(capacitySelection),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Sunday service</DialogTitle>
          <DialogDescription>
            Create a Sunday service for a specific date and hosting space.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="svc-date">Date (YYYY-MM-DD)</Label>
            <Input
              id="svc-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="2026-11-15"
              aria-invalid={!dateValid}
              aria-describedby="svc-date-help"
              disabled={saving}
            />
            <p id="svc-date-help" className="text-xs text-muted-foreground">
              Sundays only. Use the ISO date format.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-label">Label (optional)</Label>
            <Input
              id="svc-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="e.g. Thanksgiving Sunday"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-space">Hosting space</Label>
            <Select
              value={spaceId}
              onValueChange={handleSpaceChange}
              disabled={saving || spaces.length === 0}
            >
              <SelectTrigger id="svc-space">
                <SelectValue placeholder="Select a space" />
              </SelectTrigger>
              <SelectContent>
                {spaces.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-status">Status</Label>
            <Select value={status} onValueChange={setStatus} disabled={saving}>
              <SelectTrigger id="svc-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUNDAY_STATUSES.map((st) => (
                  <SelectItem key={st} value={st}>
                    {SUNDAY_STATUS_LABELS[st]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-capacity">Capacity mode</Label>
            {capacityLoadState === "loading" && <LoadingState label="Loading capacity options…" />}
            {capacityLoadState === "error" && (
              <ErrorState
                message="Capacity options could not be loaded."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRetryCapacity}
                    disabled={saving}
                  >
                    Try again
                  </Button>
                }
              />
            )}
            {capacityLoadState === "loaded" && (
              <Select
                value={capacitySelection ?? undefined}
                onValueChange={setCapacitySelection}
                disabled={saving}
              >
                <SelectTrigger id="svc-capacity">
                  <SelectValue placeholder="Select a capacity mode" />
                </SelectTrigger>
                <SelectContent>
                  {capacityOptions.map((opt) => (
                    <SelectItem
                      key={opt.capacityResourceId ?? DEFAULT_SENTINEL}
                      value={opt.capacityResourceId ?? DEFAULT_SENTINEL}
                    >
                      {opt.mode === "default"
                        ? `Use selected room/section — ${opt.totalCapacity} seats`
                        : `Use entire room — ${opt.totalCapacity} seats`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {capacityLoadState === "idle" && (
              <p className="text-xs text-muted-foreground">
                Select a hosting space to load capacity options.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Whole-room mode uses the shared capacity of the entire room and cannot overlap with
              section-mode bookings. It does not make an individual reservation exclusive.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-limit">Online booking limit (optional)</Label>
            <Input
              id="svc-limit"
              type="number"
              min={0}
              step={1}
              value={bookingLimit}
              onChange={(e) => setBookingLimit(e.target.value)}
              placeholder="Blank = not for sale"
              aria-invalid={!limitValid}
              aria-describedby="svc-limit-help"
              disabled={saving}
            />
            <p id="svc-limit-help" className="text-xs text-muted-foreground">
              Staff-controlled sales ceiling. Blank means not for sale. Setting a limit does not
              open bookings until capacity enforcement is implemented.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!formValid || saving}>
              {saving ? "Creating…" : "Create service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
