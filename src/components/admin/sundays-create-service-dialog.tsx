/**
 * Admin Sundays — create Sunday service dialog.
 */
import { useEffect, useState } from "react";

import type { VenueSpaceDTO } from "@/lib/spaces/types";
import { SUNDAY_STATUS_LABELS, SUNDAY_STATUSES } from "@/lib/sundays/constants";
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

export interface CreateServiceInput {
  date: string;
  label: string;
  spaceId: string;
  status: string;
  onlineBookingLimit: number | null;
}

interface CreateServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: VenueSpaceDTO[];
  onCreate: (input: CreateServiceInput) => void;
}

export function CreateServiceDialog({
  open,
  onOpenChange,
  spaces,
  onCreate,
}: CreateServiceDialogProps) {
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [status, setStatus] = useState<string>("scheduled");
  const [bookingLimit, setBookingLimit] = useState("");

  useEffect(() => {
    if (open) {
      setDate("");
      setLabel("");
      setSpaceId(spaces[0]?.id ?? "");
      setStatus("scheduled");
      setBookingLimit("");
    }
  }, [open, spaces]);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const spaceValid = spaceId.length > 0;
  const limitNum = bookingLimit.trim() === "" ? null : Number(bookingLimit);
  const limitValid = limitNum === null || (Number.isInteger(limitNum) && limitNum >= 0);
  const formValid = dateValid && spaceValid && limitValid;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    onCreate({
      date,
      label: label.trim(),
      spaceId,
      status,
      onlineBookingLimit: limitNum,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-space">Hosting space</Label>
            <Select value={spaceId} onValueChange={setSpaceId}>
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
            <Select value={status} onValueChange={setStatus}>
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
            />
            <p id="svc-limit-help" className="text-xs text-muted-foreground">
              Staff-controlled sales ceiling. Blank means not for sale. Setting a limit does not
              open bookings until capacity enforcement is implemented.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!formValid}>
              Create service
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
