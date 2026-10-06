/**
 * Admin Venue Spaces — /admin/spaces
 *
 * Availability foundation: list the physical spaces and edit each space's
 * saleability posture (space type, reported capacity, online booking limit,
 * active flag, display order). No booking, no Sunday services, no seating
 * times, no table layout.
 *
 * Authorization is enforced server-side by the server functions
 * (resolveSpaceActor requires availability.manage — ops_manager /
 * administrator). This UI only gates presentation.
 *
 * Setting an online booking limit does NOT open bookings. A clear notice
 * explains that Sunday services and seating times must be configured first.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { listAllVenueSpaces, updateVenueSpace } from "@/lib/spaces.functions";
import type { VenueSpaceDTO, VenueSpaceOperationResult } from "@/lib/spaces/types";
import { SPACE_TYPE_LABELS, SPACE_TYPE_DESCRIPTIONS } from "@/lib/spaces/constants";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type LoadState = "loading" | "loaded" | "error";

export function AdminSpacesPage() {
  const listSpacesFn = useServerFn(listAllVenueSpaces);
  const updateSpaceFn = useServerFn(updateVenueSpace);

  const [spaces, setSpaces] = useState<VenueSpaceDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [editTarget, setEditTarget] = useState<VenueSpaceDTO | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  /** Synchronous lock: checked and set before awaiting to prevent double-submits. */
  const actionLockRef = useRef(false);

  const loadSpaces = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const result = await listSpacesFn();
      setSpaces(result);
      setLoadState("loaded");
    } catch {
      setLoadError("We couldn't load the venue spaces. Please try again.");
      setLoadState("error");
    }
  }, [listSpacesFn]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  async function handleSave(updated: VenueSpaceDTO) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    try {
      const result: VenueSpaceOperationResult = await updateSpaceFn({
        data: {
          id: updated.id,
          expectedUpdatedAt: editTarget?.updatedAt ?? updated.updatedAt,
          name: updated.name,
          slug: updated.slug,
          description: updated.description,
          spaceType: updated.spaceType,
          reportedCapacity: updated.reportedCapacity,
          onlineBookingLimit: updated.onlineBookingLimit,
          isActive: updated.isActive,
          displayOrder: updated.displayOrder,
        },
      });
      if (result.success && result.space) {
        toast.success("Space updated.");
        setEditOpen(false);
        setEditTarget(null);
        await loadSpaces();
      } else if (result.conflict) {
        toast.error(
          "This space was modified by another user. Reload the latest data and try again.",
        );
      } else {
        toast.error(result.error ?? "Could not update space.");
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
        title="Venue Spaces"
        description="The physical rooms that can host Sunday services. Set each space's saleability posture — booking limits do not open bookings until Sunday services and seating times are configured."
      />

      <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
        <p className="text-sm text-foreground">
          <strong className="font-semibold">Setting a booking limit does not open bookings.</strong>{" "}
          Reported capacity is a physical fact for display only. The online booking limit is the
          staff-controlled sales ceiling. Bookings become available only after Sunday services and
          seating times are configured in a later phase. Mayoral Rooms stay request-only until their
          operating rules are confirmed.
        </p>
      </div>

      {loadState === "loading" && <LoadingState label="Loading venue spaces…" />}

      {loadState === "error" && (
        <ErrorState
          message={loadError || "We couldn't load the venue spaces."}
          onRetry={loadSpaces}
        />
      )}

      {loadState === "loaded" && spaces.length === 0 && (
        <EmptyState
          title="No venue spaces"
          description="No physical spaces have been configured yet."
        />
      )}

      {loadState === "loaded" && spaces.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  Space
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  Reported capacity
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  Booking limit
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  Active
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-foreground">
                  Updated
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {spaces.map((space) => (
                <tr key={space.id} className="bg-card">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{space.name}</p>
                    <p className="text-xs text-muted-foreground">{space.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-foreground">{SPACE_TYPE_LABELS[space.spaceType]}</span>
                  </td>
                  <td className="px-4 py-3 text-foreground">{space.reportedCapacity}</td>
                  <td className="px-4 py-3">
                    {space.onlineBookingLimit === null ? (
                      <span className="text-muted-foreground">Not for sale</span>
                    ) : (
                      <span className="text-foreground">{space.onlineBookingLimit}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {space.isActive ? (
                      <span className="inline-flex rounded-full bg-sage/15 px-2 py-0.5 text-xs font-medium text-sage">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(space.updatedAt).toLocaleDateString(undefined, {
                      dateStyle: "medium",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditTarget(space);
                        setEditOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loadState === "loaded" && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={loadSpaces}>
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Refresh
          </Button>
        </div>
      )}

      {editTarget && (
        <EditSpaceDialog
          space={editTarget}
          open={editOpen}
          onOpenChange={(o) => {
            setEditOpen(o);
            if (!o) setEditTarget(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

interface EditSpaceDialogProps {
  space: VenueSpaceDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: VenueSpaceDTO) => void;
}

function EditSpaceDialog({ space, open, onOpenChange, onSave }: EditSpaceDialogProps) {
  const [name, setName] = useState(space.name);
  const [slug, setSlug] = useState(space.slug);
  const [description, setDescription] = useState(space.description);
  const [spaceType, setSpaceType] = useState(space.spaceType);
  const [reportedCapacity, setReportedCapacity] = useState(String(space.reportedCapacity));
  const [bookingLimit, setBookingLimit] = useState(
    space.onlineBookingLimit === null ? "" : String(space.onlineBookingLimit),
  );
  const [isActive, setIsActive] = useState(space.isActive);
  const [displayOrder, setDisplayOrder] = useState(String(space.displayOrder));

  // Re-sync when the target space changes (e.g. after a reload).
  useEffect(() => {
    setName(space.name);
    setSlug(space.slug);
    setDescription(space.description);
    setSpaceType(space.spaceType);
    setReportedCapacity(String(space.reportedCapacity));
    setBookingLimit(space.onlineBookingLimit === null ? "" : String(space.onlineBookingLimit));
    setIsActive(space.isActive);
    setDisplayOrder(String(space.displayOrder));
  }, [space]);

  const parsedReported = Number(reportedCapacity);
  const parsedLimit = bookingLimit.trim() === "" ? null : Number(bookingLimit);
  const parsedOrder = Number(displayOrder);

  const reportedValid = Number.isInteger(parsedReported) && parsedReported >= 0;
  const limitValid = parsedLimit === null || (Number.isInteger(parsedLimit) && parsedLimit >= 0);
  const orderValid = Number.isInteger(parsedOrder) && parsedOrder >= 0;
  const nameValid = name.trim().length >= 1 && name.trim().length <= 120;
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()) && slug.trim().length <= 120;

  const formValid = reportedValid && limitValid && orderValid && nameValid && slugValid;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    onSave({
      ...space,
      name: name.trim(),
      slug: slug.trim(),
      description,
      spaceType,
      reportedCapacity: parsedReported,
      onlineBookingLimit: parsedLimit,
      isActive,
      displayOrder: parsedOrder,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit venue space</DialogTitle>
          <DialogDescription>
            Update this space's saleability posture. {SPACE_TYPE_DESCRIPTIONS[spaceType]}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="space-name">Name</Label>
            <Input
              id="space-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="space-slug">Slug</Label>
            <Input
              id="space-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={120}
              aria-describedby="space-slug-help"
            />
            <p id="space-slug-help" className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and single hyphens between words.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="space-desc">Description</Label>
            <Textarea
              id="space-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="space-type">Space type</Label>
            <Select value={spaceType} onValueChange={(v) => setSpaceType(v as typeof spaceType)}>
              <SelectTrigger id="space-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general_dining">General dining</SelectItem>
                <SelectItem value="request_only">Request only</SelectItem>
                <SelectItem value="not_bookable">Not bookable</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{SPACE_TYPE_DESCRIPTIONS[spaceType]}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="space-reported">Reported capacity</Label>
              <Input
                id="space-reported"
                type="number"
                min={0}
                step={1}
                value={reportedCapacity}
                onChange={(e) => setReportedCapacity(e.target.value)}
                aria-invalid={!reportedValid}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="space-limit">Online booking limit</Label>
              <Input
                id="space-limit"
                type="number"
                min={0}
                step={1}
                value={bookingLimit}
                onChange={(e) => setBookingLimit(e.target.value)}
                placeholder="Leave blank = not for sale"
                aria-invalid={!limitValid}
                aria-describedby="space-limit-help"
              />
              <p id="space-limit-help" className="text-xs text-muted-foreground">
                Blank means not for sale. Setting a limit does not open bookings.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="space-order">Display order</Label>
              <Input
                id="space-order"
                type="number"
                min={0}
                step={1}
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                aria-invalid={!orderValid}
              />
            </div>
            <div className="flex items-end gap-2 pb-1.5">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                Active
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!formValid}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
