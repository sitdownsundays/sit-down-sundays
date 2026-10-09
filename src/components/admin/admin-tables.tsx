/**
 * Admin Physical Tables — /admin/tables
 *
 * Lists staff-configured physical dining tables (room, label, seats, zone,
 * active/inactive) with a room filter. Adding a table is gated by
 * seating.manage (presentation only — server authorization is authoritative).
 *
 * Adding a table does NOT open reservations or change online booking limits.
 *
 * Room options are loaded through listDiningTableRoomOptions (seating.read),
 * not listAllVenueSpaces (availability.manage), so users who can manage tables
 * but not venue configuration can still load room names. Room loading is
 * tracked separately from table loading: a room-load failure never hides a
 * successfully loaded table list.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil, Plus, RefreshCw } from "lucide-react";

import {
  listDiningTables,
  createDiningTable,
  listDiningTableRoomOptions,
} from "@/lib/sundays.functions";
import type {
  DiningTableDTO,
  DiningTableOperationResult,
  DiningTableListResult,
  DiningTableRoomOptionsResult,
  DiningTableRoomOption,
} from "@/lib/sundays/types";
import { TABLE_SIZE_LABELS, TABLE_SIZES } from "@/lib/sundays/constants";
import { SPACE_TYPE_LABELS } from "@/lib/spaces/constants";
import { EditTableDialog } from "./edit-table-dialog";

import { PermissionGate } from "@/components/layout/permission-gate";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { StatusBadge } from "@/components/layout/status-badge";
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
import {
  createStaleGuard,
  tableListFromResult,
  roomOptionsFromResult,
  type TableLoadState,
  type RoomLoadState,
} from "./admin-tables-helpers";

interface AddForm {
  spaceId: string;
  label: string;
  seats: number;
  zone: string;
}

const EMPTY_FORM: AddForm = { spaceId: "", label: "", seats: 4, zone: "" };

export function AdminTablesPage() {
  const listTablesFn = useServerFn(listDiningTables);
  const createTableFn = useServerFn(createDiningTable);
  const listRoomsFn = useServerFn(listDiningTableRoomOptions);

  const [tables, setTables] = useState<DiningTableDTO[]>([]);
  const [loadState, setLoadState] = useState<TableLoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [roomFilter, setRoomFilter] = useState<string>("all");

  const [rooms, setRooms] = useState<DiningTableRoomOption[]>([]);
  const [roomState, setRoomState] = useState<RoomLoadState>("loading");
  const [roomError, setRoomError] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  /** Synchronous lock: checked and set before awaiting to prevent double-submits. */
  const submitLockRef = useRef(false);
  /** Reactive mirror of the lock for visible loading/disabled behavior. */
  const [saving, setSaving] = useState(false);

  /** The table currently being edited (null = dialog closed). */
  const [editingTable, setEditingTable] = useState<DiningTableDTO | null>(null);

  const tableGuardRef = useRef(createStaleGuard());
  const roomGuardRef = useRef(createStaleGuard());

  /** Increment to trigger a list refresh using the current roomFilter. */
  const [refreshSignal, setRefreshSignal] = useState(0);
  /** Tracks whether the component is still mounted. */
  const mountedRef = useRef(true);

  const spaceName = useCallback(
    (id: string): string => {
      const room = rooms.find((r) => r.id === id);
      if (!room) return id;
      return room.isActive ? room.name : `${room.name} (Inactive)`;
    },
    [rooms],
  );

  const loadTables = useCallback(
    async (filter: string) => {
      const reqId = tableGuardRef.current.next();
      setLoadState("loading");
      setLoadError("");
      try {
        const input = filter === "all" ? {} : { spaceId: filter };
        const result: DiningTableListResult = await listTablesFn({ data: input });
        if (tableGuardRef.current.isStale(reqId)) return;
        const mapped = tableListFromResult(result);
        setTables(mapped.tables);
        setLoadState(mapped.state);
        if (mapped.state === "error") setLoadError(mapped.error);
      } catch {
        if (tableGuardRef.current.isStale(reqId)) return;
        setLoadState("error");
        setLoadError("Could not load tables. Please try again.");
      }
    },
    [listTablesFn],
  );

  const loadRooms = useCallback(async () => {
    const reqId = roomGuardRef.current.next();
    setRoomState("loading");
    setRoomError("");
    try {
      const result: DiningTableRoomOptionsResult = await listRoomsFn();
      if (roomGuardRef.current.isStale(reqId)) return;
      const mapped = roomOptionsFromResult(result);
      setRooms(mapped.rooms);
      setRoomState(mapped.state);
      if (mapped.state === "error") setRoomError(mapped.error);
    } catch {
      if (roomGuardRef.current.isStale(reqId)) return;
      setRoomState("error");
      setRoomError("Could not load rooms. Please try again.");
    }
  }, [listRoomsFn]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void loadRooms();
    // Invalidate any in-flight room responses on unmount/re-run.
    const guard = roomGuardRef.current;
    return () => {
      guard.next();
    };
  }, [loadRooms]);

  useEffect(() => {
    void loadTables(roomFilter);
    // Invalidate any in-flight table responses on filter/refresh changes/unmount.
    const guard = tableGuardRef.current;
    return () => {
      guard.next();
    };
  }, [loadTables, roomFilter, refreshSignal]);

  // Active rooms are the only ones offered for new table creation.
  const activeRooms = rooms.filter((r) => r.isActive);

  function openAdd() {
    setForm(EMPTY_FORM);
    setFormError("");
    setAddOpen(true);
  }

  async function handleSubmit() {
    if (submitLockRef.current) return;
    if (!form.spaceId) {
      setFormError("Select a room.");
      return;
    }
    if (!form.label.trim()) {
      setFormError("Label is required.");
      return;
    }
    submitLockRef.current = true;
    setSaving(true);
    try {
      const result: DiningTableOperationResult = await createTableFn({
        data: {
          spaceId: form.spaceId,
          label: form.label.trim(),
          seats: form.seats,
          zone: form.zone.trim() || undefined,
        },
      });
      if (result.success) {
        if (!mountedRef.current) return;
        toast.success("Table added.");
        setForm(EMPTY_FORM);
        setFormError("");
        setAddOpen(false);
        // Trigger a refresh via signal so the list effect uses the CURRENT
        // roomFilter, not the filter captured when submission began.
        setRefreshSignal((n) => n + 1);
      } else if (result.conflict) {
        setFormError("This table was modified by another user. Close and reopen the form.");
      } else {
        setFormError(result.error ?? "Could not add the table.");
      }
    } catch {
      setFormError("Something went wrong. Your entries are preserved.");
    } finally {
      submitLockRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  const filtered = tables;

  const addDisabled = roomState !== "loaded" || activeRooms.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sundays & Seating"
        title="Tables"
        description="Manage physical dining tables by room."
        actions={
          <PermissionGate permission="seating.manage">
            <Button onClick={openAdd} disabled={saving || addDisabled}>
              <Plus className="size-4" /> Add table
            </Button>
          </PermissionGate>
        }
      />

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Physical tables are configured here. Adding a table does not open reservations or change
        online booking limits.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <Label htmlFor="room-filter" className="mb-1.5 block text-sm">
            Filter by room
          </Label>
          <Select
            value={roomFilter}
            onValueChange={setRoomFilter}
            disabled={roomState !== "loaded"}
          >
            <SelectTrigger id="room-filter" className="w-full">
              <SelectValue placeholder="All rooms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rooms</SelectItem>
              {rooms.map((room) => (
                <SelectItem key={room.id} value={room.id}>
                  {room.isActive ? room.name : `${room.name} (Inactive)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void loadTables(roomFilter)}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>

      {roomState === "loading" && (
        <div className="text-sm text-muted-foreground">Loading rooms…</div>
      )}

      {roomState === "error" && (
        <ErrorState
          title="Couldn't load rooms"
          message={roomError || "Please try again."}
          action={
            <Button onClick={() => void loadRooms()}>
              <RefreshCw className="size-4" /> Retry
            </Button>
          }
        />
      )}

      {roomState === "loaded" && activeRooms.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          No active rooms are available. An authorized manager must configure an active venue space
          before tables can be added.
        </div>
      )}

      {loadState === "loading" && <LoadingState label="Loading tables…" />}

      {loadState === "error" && (
        <ErrorState
          title="Couldn't load tables"
          message={loadError || "Please try again."}
          action={
            <Button onClick={() => void loadTables(roomFilter)}>
              <RefreshCw className="size-4" /> Retry
            </Button>
          }
        />
      )}

      {loadState === "loaded" && filtered.length === 0 && (
        <EmptyState
          title="No tables configured"
          description={
            roomFilter === "all"
              ? "Add your first physical table to get started."
              : "No tables in this room yet."
          }
        />
      )}

      {loadState === "loaded" && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Room</th>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Seats</th>
                <th className="px-4 py-3 font-medium">Zone</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((t) => (
                <tr key={t.id} className="bg-card">
                  <td className="px-4 py-3 text-foreground">{spaceName(t.spaceId)}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{t.label}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.seats}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.zone || <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {t.isActive ? (
                      <StatusBadge tone="success">Active</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Inactive</StatusBadge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PermissionGate permission="seating.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingTable(t)}
                        aria-label={`Edit ${t.label}`}
                      >
                        <Pencil className="size-4" /> Edit
                      </Button>
                    </PermissionGate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!saving) setAddOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add physical table</DialogTitle>
            <DialogDescription>
              Configure a physical table in a room. This does not open reservations or change
              booking limits.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-room">Room</Label>
              <Select
                value={form.spaceId}
                onValueChange={(v) => setForm((f) => ({ ...f, spaceId: v }))}
                disabled={saving}
              >
                <SelectTrigger id="add-room" className="w-full">
                  <SelectValue placeholder="Select a room" />
                </SelectTrigger>
                <SelectContent>
                  {activeRooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {room.name}{" "}
                      <span className="text-muted-foreground">
                        ({SPACE_TYPE_LABELS[room.spaceType]})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-label">Table label</Label>
              <Input
                id="add-label"
                value={form.label}
                maxLength={120}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. A1"
                aria-describedby="add-label-help"
                disabled={saving}
              />
              <p id="add-label-help" className="text-xs text-muted-foreground">
                Unique within the room.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-seats">Seats</Label>
              <Select
                value={String(form.seats)}
                onValueChange={(v) => setForm((f) => ({ ...f, seats: Number(v) }))}
                disabled={saving}
              >
                <SelectTrigger id="add-seats" className="w-full">
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
              <Label htmlFor="add-zone">Zone (optional)</Label>
              <Input
                id="add-zone"
                value={form.zone}
                maxLength={120}
                onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
                placeholder="e.g. Main Floor"
                disabled={saving}
              />
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving…" : "Add table"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditTableDialog
        table={editingTable}
        roomName={editingTable ? spaceName(editingTable.spaceId) : ""}
        spaceTypeLabel={
          editingTable
            ? SPACE_TYPE_LABELS[
                rooms.find((r) => r.id === editingTable.spaceId)?.spaceType ?? "general_dining"
              ]
            : ""
        }
        onSaved={() => setRefreshSignal((n) => n + 1)}
        onClose={() => setEditingTable(null)}
      />
    </div>
  );
}
