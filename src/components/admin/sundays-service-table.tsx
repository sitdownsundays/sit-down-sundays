/**
 * Admin Sundays — service list table.
 *
 * Presentational component. The expanded seating panel is injected via a
 * render prop so the table stays free of server-function wiring.
 */
import { ChevronRight, ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import type { SundayServiceDTO } from "@/lib/sundays/types";
import type { VenueSpaceDTO } from "@/lib/spaces/types";
import { SUNDAY_STATUS_LABELS } from "@/lib/sundays/constants";
import { Button } from "@/components/ui/button";

interface SundayServiceTableProps {
  services: SundayServiceDTO[];
  spaces: VenueSpaceDTO[];
  selectedServiceId: string | null;
  onSelect: (id: string | null) => void;
  /** Renders the expanded seating panel for the given service. */
  renderSeatingPanel: (service: SundayServiceDTO) => ReactNode;
}

export function SundayServiceTable({
  services,
  spaces,
  selectedServiceId,
  onSelect,
  renderSeatingPanel,
}: SundayServiceTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold text-foreground">
              Date
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-foreground">
              Label
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-foreground">
              Space
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-foreground">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-foreground">
              Booking limit
            </th>
            <th scope="col" className="px-4 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {services.map((service) => {
            const space = spaces.find((s) => s.id === service.spaceId);
            const expanded = selectedServiceId === service.id;
            return (
              <>
                <tr key={service.id} className="bg-card">
                  <td className="px-4 py-3 font-medium text-foreground">{service.date}</td>
                  <td className="px-4 py-3 text-foreground">{service.label || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{space?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                      {SUNDAY_STATUS_LABELS[service.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {service.onlineBookingLimit === null ? (
                      <span className="text-muted-foreground">Not set</span>
                    ) : (
                      <span className="text-foreground">{service.onlineBookingLimit}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded}
                      aria-label={expanded ? "Hide seating times" : "Show seating times"}
                      onClick={() => onSelect(expanded ? null : service.id)}
                    >
                      {expanded ? (
                        <ChevronLeft className="mr-1 size-4" aria-hidden />
                      ) : (
                        <ChevronRight className="mr-1 size-4" aria-hidden />
                      )}
                      {expanded ? "Hide" : "Seating"}
                    </Button>
                  </td>
                </tr>
                {expanded && (
                  <tr key={`${service.id}-seating`}>
                    <td colSpan={6} className="bg-muted/20 px-4 py-4">
                      {renderSeatingPanel(service)}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
