/**
 * Admin Menu Items — item manager panel.
 *
 * Shown for a selected non-archived menu. Loads the menu detail (with its
 * items and sections) fresh from the server when the panel opens and
 * whenever menu.id changes, starting in a loading state rather than trusting
 * a stale snapshot. A request-generation guard ensures an older response
 * cannot overwrite a newer selected menu. Supports create / edit / activate /
 * deactivate / reorder through the existing authenticated server functions.
 *
 * - A synchronous ref-backed lock prevents double-submits.
 * - setItemActive sends expectedUpdatedAt; a stale edit returns a conflict.
 * - On a failed reorder, the authoritative server order is reloaded — no
 *   optimistic order is retained.
 * - When detail.status is archived, the table is read-only: edit, activation,
 *   and reorder controls are disabled, and any open dialog is closed.
 * - Deactivating the final publicly eligible item of a published menu fails
 *   safely (server/database invariant) and the item remains active.
 *
 * Authorization is enforced server-side by the server functions
 * (resolveMenuActor + hasMutationRole). This UI only gates presentation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";

import { getMenuDetail, reorderItems, setItemActive } from "@/lib/menu.functions";
import type { MenuActionResult, MenuItemDTO, MenuWithContentDTO } from "@/lib/menu/types";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";

import { ItemTable } from "./item-table";
import { CreateItemDialog } from "./item-create-dialog";
import { EditItemDialog } from "./item-edit-dialog";

interface MenuItemsPanelProps {
  menu: MenuWithContentDTO;
  onBack: () => void;
}

export function MenuItemsPanel({ menu, onBack }: MenuItemsPanelProps) {
  const getMenuDetailFn = useServerFn(getMenuDetail);
  const reorderItemsFn = useServerFn(reorderItems);
  const setItemActiveFn = useServerFn(setItemActive);

  const [detail, setDetail] = useState<MenuWithContentDTO>(menu);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string>("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MenuItemDTO | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<MenuItemDTO | null>(null);

  /** Item id with an in-flight action (rendering disabled state). */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reorderPending, setReorderPending] = useState(false);
  /** Synchronous lock: checked and set before awaiting to prevent double-submits. */
  const actionLockRef = useRef(false);
  /** Request-generation guard: an older response cannot overwrite a newer menu. */
  const genRef = useRef(0);
  /** Mounted guard: do not update state after unmount. */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const gen = ++genRef.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const res = await getMenuDetailFn({ data: { id: menu.id } });
      if (gen !== genRef.current || !mountedRef.current) return;
      if (res.ok && res.menu) {
        setDetail(res.menu);
        setLoadState("loaded");
        if (res.menu.status === "archived") {
          setCreateOpen(false);
          setEditOpen(false);
          setEditTarget(null);
          setDeactivateTarget(null);
        }
      } else if (res.ok && !res.menu) {
        setLoadError("This menu could not be found.");
        setLoadState("error");
      } else {
        setLoadError(res.message);
        setLoadState("error");
      }
    } catch {
      if (gen !== genRef.current || !mountedRef.current) return;
      setLoadError("Menu content could not be loaded.");
      setLoadState("error");
    }
  }, [getMenuDetailFn, menu.id]);

  useEffect(() => {
    setDetail(menu);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.id]);

  const isArchived = detail.status === "archived";

  function handleCreated() {
    setCreateOpen(false);
    toast.success("Item created.");
    void reload();
  }

  function handleUpdated() {
    setEditOpen(false);
    setEditTarget(null);
    toast.success("Item updated.");
    void reload();
  }

  function handleConflictReload() {
    setEditOpen(false);
    setEditTarget(null);
    void reload();
  }

  async function handleToggleActive(item: MenuItemDTO) {
    if (isArchived) return;
    if (item.isActive) {
      setDeactivateTarget(item);
      return;
    }
    await runAction(item.id, async () => {
      const res: MenuActionResult = await setItemActiveFn({
        data: { id: item.id, isActive: true, expectedUpdatedAt: item.updatedAt },
      });
      if (res.ok) {
        toast.success("Item activated.");
        void reload();
      } else if (res.kind === "conflict") {
        toast.error("This item was changed by someone else. Reload and try again.");
        void reload();
      } else {
        toast.error(res.message);
        void reload();
      }
    });
  }

  async function confirmDeactivate() {
    const item = deactivateTarget;
    setDeactivateTarget(null);
    if (!item) return;
    await runAction(item.id, async () => {
      const res: MenuActionResult = await setItemActiveFn({
        data: { id: item.id, isActive: false, expectedUpdatedAt: item.updatedAt },
      });
      if (res.ok) {
        toast.success("Item deactivated.");
        void reload();
      } else if (res.kind === "conflict") {
        toast.error("This item was changed by someone else. Reload and try again.");
        void reload();
      } else {
        toast.error(res.message);
        void reload();
      }
    });
  }

  async function handleReorder(orderedIds: string[]) {
    if (isArchived) return;
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setReorderPending(true);
    try {
      const res: MenuActionResult = await reorderItemsFn({
        data: { menuId: menu.id, orderedIds },
      });
      if (res.ok) {
        toast.success("Items reordered.");
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Items could not be reordered.");
    } finally {
      actionLockRef.current = false;
      setReorderPending(false);
      // Always reload authoritative server order — never retain an optimistic
      // order, whether the reorder succeeded or failed.
      void reload();
    }
  }

  /** Run a single-item action with the synchronous double-submit lock. */
  async function runAction(itemId: string, fn: () => Promise<void>) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setPendingId(itemId);
    try {
      await fn();
    } catch {
      toast.error("Menu content could not be saved.");
    } finally {
      actionLockRef.current = false;
      setPendingId(null);
    }
  }

  const items = [...detail.items].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
            <ArrowLeft className="size-4" aria-hidden />
            Back to menus
          </Button>
          <h2 className="text-xl font-semibold text-foreground">Items — {detail.name}</h2>
          <p className="text-sm text-muted-foreground">
            Manage the dishes guests see on this menu.
          </p>
        </div>
        {!isArchived && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New item
          </Button>
        )}
      </div>

      {isArchived && (
        <div
          className="rounded-md border border-warning/40 bg-warning/10 p-3"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-medium text-warning-foreground">This menu is archived.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Archived menus cannot be edited. Restore is not available.
          </p>
        </div>
      )}

      <section aria-label="Item list" aria-live="polite">
        {loadState === "loading" && <LoadingState label="Loading items…" />}

        {loadState === "error" && (
          <ErrorState
            title="Items could not be loaded"
            message={loadError || "Please try again."}
            action={
              <Button variant="outline" onClick={() => void reload()}>
                <RefreshCw className="size-4" aria-hidden />
                Try again
              </Button>
            }
          />
        )}

        {loadState === "loaded" && items.length === 0 && !isArchived && (
          <EmptyState
            title="No items yet"
            description="Create your first item to add a dish to this menu."
            icon={<Plus className="size-8" aria-hidden />}
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                New item
              </Button>
            }
          />
        )}

        {loadState === "loaded" && items.length === 0 && isArchived && (
          <EmptyState
            title="No items"
            description="This archived menu has no items."
            icon={<Plus className="size-8" aria-hidden />}
          />
        )}

        {loadState === "loaded" && items.length > 0 && (
          <ItemTable
            items={items}
            sections={detail.sections}
            onEdit={(i) => {
              setEditTarget(i);
              setEditOpen(true);
            }}
            onToggleActive={handleToggleActive}
            onReorder={handleReorder}
            pendingId={pendingId}
            reorderPending={reorderPending}
            readOnly={isArchived}
          />
        )}

        {loadState === "loaded" && items.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Reordering saves the complete list in one step. Deactivating the final eligible item of
            a published menu is not permitted.
          </p>
        )}
      </section>

      {!isArchived && (
        <CreateItemDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          menuId={menu.id}
          sections={detail.sections}
          onCreated={handleCreated}
        />
      )}

      <EditItemDialog
        open={editOpen && !isArchived}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditTarget(null);
        }}
        item={editTarget}
        sections={detail.sections}
        onUpdated={handleUpdated}
        onConflictReload={handleConflictReload}
      />

      <AlertDialog
        open={deactivateTarget !== null && !isArchived}
        onOpenChange={(o) => {
          if (!o) setDeactivateTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this item?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget
                ? `“${deactivateTarget.name}” will be hidden from the public menu. You can reactivate it later. Deactivating the final eligible item of a published menu is not permitted.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDeactivate()}
            >
              Deactivate item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
