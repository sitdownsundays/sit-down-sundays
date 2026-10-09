/**
 * Edit Table dialog — edit label, seats, zone, and active/inactive status.
 *
 * Room is displayed read-only (no reassignment in this slice). Submits the
 * table ID and the ORIGINAL updatedAt as expectedUpdatedAt. On a concurrency
 * conflict the dialog stays open, explains the conflict, and offers
 * "Reload latest" to fetch the current record and replace form values — it
 * never retries automatically or bypasses optimistic concurrency.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";

import { listDiningTables, updateDiningTable } from "@/lib/sundays.functions";
import type {
  DiningTableDTO,
  DiningTableListResult,
  DiningTableOperationResult,
} from "@/lib/sundays/types";
import { TABLE_SIZE_LABELS, TABLE_SIZES } from "@/lib/sundays/constants";
import { SPACE_TYPE_LABELS } from "@/lib/spaces/constants";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  editFormFromTable,
  buildUpdatePayload,
  formHasChanges,
  validateEditForm,
  isConflict,
  type EditTableForm,
} from "./admin-tables-edit-helpers";

interface EditTableDialogProps {
  /** The table to edit. When set, the dialog is open. */
  table: DiningTableDTO | null;
  /** Display name of the table's room (read-only). */
  roomName: string;
  /** spaceType label for the read-only room line. */
  spaceTypeLabel: string;
  /** Called after a successful save so the parent refreshes the list. */
  onSaved: () => void;
  /** Called when the dialog is dismissed (cancel / outside click / escape). */
  onClose: () => void;
}

export function EditTableDialog({
  table,
  roomName,
  spaceTypeLabel,
  onSaved,
  onClose,
}: EditTableDialogProps) {
  const updateTableFn = useServerFn(updateDiningTable);
  const listTablesFn = useServerFn(listDiningTables);

  const [form, setForm] = useState<EditTableForm>(() =>
    table ? editFormFromTable(table) : { label: "", seats: 4, zone: "", isActive: true },
  );
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Synchronous lock: checked before awaiting to prevent double-submits. */
  const submitLockRef = useRef(false);
  /** The table record the form is currently based on (for expectedUpdatedAt). */
  const [baseTable, setBaseTable] = useState<DiningTableDTO | null>(table);

  // Re-initialize the form whenever a different table is opened.
  useEffect(() => {
    if (table) {
      setForm(editFormFromTable(table));
      setBaseTable(table);
      setError("");
      setConflict(false);
      setReloading(false);
    }
  }, [table]);

  const open = table !== null;

  async function handleSubmit() {
    if (!baseTable) return;
    if (submitLockRef.current) return;

    const validation = validateEditForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    if (!formHasChanges(baseTable, form)) {
      setError("No changes to save.");
      return;
    }

    submitLockRef.current = true;
    setSaving(true);
    setError("");
    setConflict(false);
    try {
      const payload = buildUpdatePayload(baseTable, form);
      const result: DiningTableOperationResult = await updateTableFn({ data: payload });
      if (result.success) {
        onSaved();
        onClose();
        return;
      }
      if (isConflict(result)) {
        setConflict(true);
        setError("Another user changed this table. Reload the latest version to continue.");
      } else {
        setError(result.error ?? "Could not save the table. Your entries are preserved.");
      }
    } catch {
      setError("Something went wrong. Your entries are preserved.");
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  }

  async function handleReloadLatest() {
    if (!baseTable) return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setReloading(true);
    setError("");
    try {
      const result: DiningTableListResult = await listTablesFn({ data: {} });
      if (!result.ok) {
        setError("Could not load the latest table. Please try again.");
        return;
      }
      const latest = result.tables.find((t) => t.id === baseTable.id);
      if (!latest) {
        setError("This table no longer exists.");
        return;
      }
      // Adopt the fetched record's values AND its timestamp as the new basis.
      setBaseTable(latest);
      setForm(editFormFromTable(latest));
      setConflict(false);
      setError("");
    } catch {
      setError("Could not load the latest table. Please try again.");
    } finally {
      submitLockRef.current = false;
      setReloading(false);
    }
  }

  const busy = saving || reloading;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit table</DialogTitle>
          <DialogDescription>
            Update this physical table's label, seats, zone, or status. Disabling a table does not
            cancel reservations or change booking limits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-room">Room</Label>
            <div
              id="edit-room"
              className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground"
            >
              {roomName} <span className="ml-1">({spaceTypeLabel})</span>
            </div>
            <p className="text-xs text-muted-foreground">Room cannot be changed here.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-label">Table label</Label>
            <Input
              id="edit-label"
              value={form.label}
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. A1"
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-seats">Seats</Label>
            <Select
              value={String(form.seats)}
              onValueChange={(v) => setForm((f) => ({ ...f, seats: Number(v) }))}
              disabled={busy}
            >
              <SelectTrigger id="edit-seats" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABLE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {TABLE_SIZE_LABELS[size]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-zone">Zone (optional)</Label>
            <Input
              id="edit-zone"
              value={form.zone}
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
              placeholder="e.g. Main Floor"
              disabled={busy}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="edit-active">Active</Label>
              <p className="text-xs text-muted-foreground">
                Inactive tables stay listed and can be reactivated.
              </p>
            </div>
            <Switch
              id="edit-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              disabled={busy}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {conflict && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">This table was changed by another user.</p>
              <p className="mt-1 text-muted-foreground">
                Reload the latest version to adopt its current values and timestamp, then make your
                edits again.
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy}>
            {saving ? "Saving…" : reloading ? "Reloading…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { SPACE_TYPE_LABELS };
