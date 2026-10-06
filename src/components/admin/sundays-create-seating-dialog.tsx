/**
 * Admin Sundays — create seating time dialog.
 */
import { useEffect, useState } from "react";

import {
  SERVICE_WINDOW_START,
  SERVICE_WINDOW_END,
  LATEST_RESERVATION_START,
} from "@/lib/sundays/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CreateSeatingInput {
  label: string;
  startTime: string;
  endTime: string;
  onlineBookingLimit: number | null;
}

interface CreateSeatingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateSeatingInput) => void;
}

export function CreateSeatingDialog({ open, onOpenChange, onCreate }: CreateSeatingDialogProps) {
  const [label, setLabel] = useState("");
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("");
  const [bookingLimit, setBookingLimit] = useState("");

  useEffect(() => {
    if (open) {
      setLabel("");
      setStartTime("12:00");
      setEndTime("");
      setBookingLimit("");
    }
  }, [open]);

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  const startValid = timeRegex.test(startTime);
  const endValid = timeRegex.test(endTime);
  const labelValid = label.trim().length >= 1 && label.trim().length <= 120;
  const limitNum = bookingLimit.trim() === "" ? null : Number(bookingLimit);
  const limitValid = limitNum === null || (Number.isInteger(limitNum) && limitNum >= 0);
  const formValid = startValid && endValid && labelValid && limitValid;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    onCreate({
      label: label.trim(),
      startTime,
      endTime,
      onlineBookingLimit: limitNum,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add seating time</DialogTitle>
          <DialogDescription>
            Start times {SERVICE_WINDOW_START}–{LATEST_RESERVATION_START}. Service ends at{" "}
            {SERVICE_WINDOW_END}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="seating-label">Label</Label>
            <Input
              id="seating-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder="e.g. First seating"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="seating-start">Start time (HH:MM, 24h)</Label>
              <Input
                id="seating-start"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="12:00"
                aria-invalid={!startValid}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seating-end">End time (HH:MM, 24h)</Label>
              <Input
                id="seating-end"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="14:30"
                aria-invalid={!endValid}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seating-limit">Online booking limit (optional)</Label>
            <Input
              id="seating-limit"
              type="number"
              min={0}
              step={1}
              value={bookingLimit}
              onChange={(e) => setBookingLimit(e.target.value)}
              placeholder="Blank = not for sale"
              aria-invalid={!limitValid}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!formValid}>
              Create seating
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
