/**
 * Admin Sundays & Seating — /admin/sundays
 *
 * Manage Sunday services (date, hosting space, status, booking limit) and the
 * seating times for each service. Sundays only, noon–7 PM, 2.5-hour dining
 * duration, latest reservation start 4:30 PM. Staff-configured capacity only;
 * no invented availability or table inventory. Overlapping seating starts are
 * NOT treated as independent room capacity pools.
 *
 * Authorization is enforced server-side (resolveSundaysActor requires
 * availability.manage — ops_manager / administrator). This UI only gates
 * presentation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, Plus } from "lucide-react";

import {
  listAllSundayServices,
  createSundayService,
  updateSundayService,
} from "@/lib/sundays.functions";
import { listAllVenueSpaces } from "@/lib/spaces.functions";
import type { SundayServiceDTO, SundayServiceOperationResult } from "@/lib/sundays/types";
import type { VenueSpaceDTO } from "@/lib/spaces/types";
import {
  SERVICE_WINDOW_START,
  SERVICE_WINDOW_END,
  LATEST_RESERVATION_START,
  DINING_DURATION_HOURS,
} from "@/lib/sundays/constants";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import { SundayServiceTable } from "./sundays-service-table";
import { SeatingTimesPanel } from "./sundays-seating-panel";
import { CreateServiceDialog, type CreateServiceInput } from "./sundays-create-service-dialog";

type LoadState = "loading" | "loaded" | "error";

export function AdminSundaysPage() {
  const listServicesFn = useServerFn(listAllSundayServices);
  const createServiceFn = useServerFn(createSundayService);
  const updateServiceFn = useServerFn(updateSundayService);
  const listSpacesFn = useServerFn(listAllVenueSpaces);

  const [services, setServices] = useState<SundayServiceDTO[]>([]);
  const [spaces, setSpaces] = useState<VenueSpaceDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const actionLockRef = useRef(false);

  const loadServices = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const [svcResult, spaceResult] = await Promise.all([listServicesFn(), listSpacesFn()]);
      setServices(svcResult);
      setSpaces(spaceResult);
      setLoadState("loaded");
    } catch {
      setLoadError("We couldn't load Sunday services. Please try again.");
      setLoadState("error");
    }
  }, [listServicesFn, listSpacesFn]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  async function handleCreateService(input: CreateServiceInput) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    try {
      const result: SundayServiceOperationResult = await createServiceFn({
        data: {
          date: input.date,
          label: input.label || undefined,
          spaceId: input.spaceId,
          status: input.status,
          onlineBookingLimit: input.onlineBookingLimit,
        },
      });
      if (result.success && result.data) {
        toast.success("Sunday service created.");
        setCreateOpen(false);
        await loadServices();
      } else {
        toast.error(result.error ?? "Could not create Sunday service.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      actionLockRef.current = false;
    }
  }

  async function handleUpdateService(updated: SundayServiceDTO) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    try {
      const result: SundayServiceOperationResult = await updateServiceFn({
        data: {
          id: updated.id,
          expectedUpdatedAt: updated.updatedAt,
          label: updated.label,
          status: updated.status,
          spaceId: updated.spaceId,
          onlineBookingLimit: updated.onlineBookingLimit,
          isActive: updated.isActive,
          displayOrder: updated.displayOrder,
        },
      });
      if (result.success) {
        toast.success("Sunday service updated.");
        await loadServices();
      } else if (result.conflict) {
        toast.error("This service was modified by another user. Reload and try again.");
      } else {
        toast.error(result.error ?? "Could not update Sunday service.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      actionLockRef.current = false;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sundays & Seating"
        title="Sunday Services"
        description="Manage Sunday service availability and the seating times for each service. Sundays only, noon to 7 PM, with a 2.5-hour dining duration."
      />

      <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
        <p className="text-sm text-foreground">
          <strong className="font-semibold">Service window:</strong> {SERVICE_WINDOW_START}–
          {SERVICE_WINDOW_END} (noon–7 PM). Dining duration {DINING_DURATION_HOURS} hours. Latest
          permitted reservation start {LATEST_RESERVATION_START} (4:30 PM). Setting a booking limit
          does not open bookings until capacity enforcement is implemented. Overlapping seating
          starts are not independent room capacity pools.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-foreground">Services</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadServices}>
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" aria-hidden />
            Add Sunday
          </Button>
        </div>
      </div>

      {loadState === "loading" && <LoadingState label="Loading Sunday services…" />}

      {loadState === "error" && (
        <ErrorState
          message={loadError || "We couldn't load Sunday services."}
          onRetry={loadServices}
        />
      )}

      {loadState === "loaded" && services.length === 0 && (
        <EmptyState
          title="No Sunday services"
          description="Add a Sunday service to begin configuring availability."
        />
      )}

      {loadState === "loaded" && services.length > 0 && (
        <SundayServiceTable
          services={services}
          spaces={spaces}
          selectedServiceId={selectedServiceId}
          onSelect={setSelectedServiceId}
          renderSeatingPanel={(service) => <SeatingTimesPanel service={service} />}
        />
      )}

      <CreateServiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        spaces={spaces}
        onCreate={handleCreateService}
      />
    </div>
  );
}
