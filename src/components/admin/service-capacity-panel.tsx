/**
 * Admin Sundays — capacity-mode editing for an EXISTING Sunday service.
 *
 * Loads valid capacity options via listServiceCapacityOptions and saves
 * through updateSundayService (capacityResourceId only). Gated by
 * availability.manage. Server authorization remains authoritative.
 *
 * Does NOT require capacity_control.ready=true; managers can configure
 * capacity mode before activation. No hardcoded 60/120/950 values.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { listServiceCapacityOptions, updateSundayService } from "@/lib/sundays.functions";
import type { SundayServiceDTO, SundayServiceOperationResult } from "@/lib/sundays/types";
import type { ServiceCapacityOption } from "@/lib/sundays/service-capacity-options";

import { PermissionGate } from "@/components/layout/permission-gate";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_SENTINEL,
  capacityValueToSelection,
  initializeSelection,
  hasActualChange,
  buildCapacitySavePayload,
} from "./service-capacity-helpers";

interface ServiceCapacityPanelProps {
  service: SundayServiceDTO;
  onRefreshParent: () => Promise<void>;
}

type LoadState = "idle" | "loading" | "loaded" | "error";
type SaveState = "idle" | "saving";

export function ServiceCapacityPanel({ service, onRefreshParent }: ServiceCapacityPanelProps) {
  const loadOptionsFn = useServerFn(listServiceCapacityOptions);
  const updateServiceFn = useServerFn(updateSundayService);

  const [options, setOptions] = useState<ServiceCapacityOption[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [selection, setSelection] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [needsReload, setNeedsReload] = useState(false);

  // Track service identity + operation generation for stale-response safety.
  const serviceIdRef = useRef<string>(service.id);
  const opGenRef = useRef(0);

  const loadOptions = useCallback(
    async (svc: SundayServiceDTO): Promise<boolean> => {
      const gen = opGenRef.current + 1;
      opGenRef.current = gen;
      setLoadState("loading");
      try {
        const result = await loadOptionsFn({ data: { spaceId: svc.spaceId } });
        // Ignore stale responses (service changed, unmount, or newer load).
        if (serviceIdRef.current !== svc.id || opGenRef.current !== gen) return false;
        if (result.ok) {
          setOptions(result.options);
          setSelection(initializeSelection(svc.capacityResourceId, result.options));
          setLoadState("loaded");
          setNeedsReload(false);
          return true;
        } else {
          setOptions([]);
          setSelection(null);
          setLoadState("error");
          return false;
        }
      } catch {
        if (serviceIdRef.current !== svc.id || opGenRef.current !== gen) return false;
        setOptions([]);
        setSelection(null);
        setLoadState("error");
        return false;
      }
    },
    [loadOptionsFn],
  );

  // Load when the service identity changes.
  useEffect(() => {
    if (serviceIdRef.current !== service.id) {
      serviceIdRef.current = service.id;
      opGenRef.current = 0;
      setOptions([]);
      setSelection(null);
      setLoadState("idle");
      setSaveState("idle");
      setNeedsReload(false);
    }
    void loadOptions(service);
    return () => {
      // Invalidate pending operations on unmount.
      opGenRef.current = opGenRef.current + 1;
    };
  }, [service, loadOptions]);

  const canSave =
    loadState === "loaded" &&
    saveState === "idle" &&
    !needsReload &&
    hasActualChange(service.capacityResourceId, selection);

  function handleSelectionChange(value: string) {
    if (saveState === "saving" || needsReload) return;
    setSelection(value);
  }

  async function handleSave() {
    if (saveState === "saving" || needsReload) return;
    const payload = buildCapacitySavePayload(service, selection, options);
    if (!payload) return;
    setSaveState("saving");
    try {
      const result: SundayServiceOperationResult = await updateServiceFn({
        data: payload,
      });
      if (result.success && result.data) {
        toast.success("Capacity mode updated.");
        // Adopt the returned record/timestamp via parent refresh.
        try {
          await onRefreshParent();
        } catch {
          // Refresh failure is not a failed capacity update.
          toast.error("Saved, but the list could not be refreshed. Reload the page.");
        }
        // Reload options so the selection reflects the adopted record.
        await loadOptions(result.data);
      } else if (result.conflict) {
        toast.error("This service was modified by another user. Reload and try again.");
        setNeedsReload(true);
      } else {
        toast.error(result.error ?? "Could not update capacity mode.");
        setNeedsReload(true);
      }
    } catch {
      toast.error("Could not confirm the update. Reload the service before trying again.");
      setNeedsReload(true);
    } finally {
      setSaveState("idle");
    }
  }

  async function handleReload() {
    if (saveState === "saving") return;
    setNeedsReload(false);
    const ok = await loadOptions(service);
    if (!ok) {
      setNeedsReload(true);
    }
  }

  return (
    <PermissionGate permission="availability.manage">
      <div className="mt-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Capacity mode</h4>
          {loadState === "loaded" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadOptions(service)}
              disabled={saveState === "saving"}
            >
              <RefreshCw className="mr-1 size-3.5" aria-hidden />
              Refresh
            </Button>
          )}
        </div>

        {loadState === "loading" && <LoadingState label="Loading capacity options…" />}

        {loadState === "error" && (
          <ErrorState
            message="Capacity options could not be loaded."
            action={
              <Button variant="outline" size="sm" onClick={() => void loadOptions(service)}>
                Try again
              </Button>
            }
          />
        )}

        {loadState === "loaded" && (
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="capacity-mode-select" className="text-xs font-medium text-foreground">
                Room capacity mode
              </label>
              <Select
                value={selection ?? undefined}
                onValueChange={handleSelectionChange}
                disabled={saveState === "saving" || needsReload}
              >
                <SelectTrigger id="capacity-mode-select" className="w-full">
                  <SelectValue placeholder="Select a capacity mode" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((opt) => (
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
            </div>

            {selection === null && (
              <p className="text-xs text-muted-foreground">
                The saved capacity mode is no longer available. Choose an offered option before
                saving.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Whole-room mode uses the shared capacity of the entire room and cannot overlap with
              section-mode bookings. It does not make an individual reservation exclusive.
            </p>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
                {saveState === "saving" ? "Saving…" : "Save capacity mode"}
              </Button>

              {needsReload && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleReload()}
                  disabled={saveState === "saving"}
                >
                  <RefreshCw className="mr-1 size-3.5" aria-hidden />
                  Reload latest
                </Button>
              )}
            </div>

            {saveState === "saving" && (
              <p className="text-xs text-muted-foreground">Controls are disabled while saving.</p>
            )}
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
