/**
 * Admin Menu Sections — section manager panel.
 *
 * Shown for a selected non-archived menu. Loads the menu detail (with its
 * sections) fresh from the server when the panel opens and whenever menu.id
 * changes, starting in a loading state rather than trusting a stale snapshot.
 * A request-generation guard ensures an older response cannot overwrite a
 * newer selected menu. Supports create / edit / activate / deactivate /
 * reorder through the existing authenticated server functions.
 *
 * - A synchronous ref-backed lock prevents double-submits.
 * - setSectionActive sends expectedUpdatedAt; a stale edit returns a conflict.
 * - On a failed reorder, the authoritative server order is reloaded — no
 *   optimistic order is retained.
 * - When detail.status is archived, the table is read-only: edit, activation,
 *   and reorder controls are disabled, and any open dialog is closed.
 *
 * Authorization is enforced server-side by the server functions
 * (resolveMenuActor + hasMutationRole). This UI only gates presentation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";

import { getMenuDetail, reorderSections, setSectionActive } from "@/lib/menu.functions";
import type { MenuActionResult, MenuSectionDTO, MenuWithContentDTO } from "@/lib/menu/types";

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

import { SectionTable } from "./section-table";
import { CreateSectionDialog } from "./section-create-dialog";
import { EditSectionDialog } from "./section-edit-dialog";

interface MenuSectionsPanelProps {
  menu: MenuWithContentDTO;
  onBack: () => void;
}

export function MenuSectionsPanel({ menu, onBack }: MenuSectionsPanelProps) {
  const getMenuDetailFn = useServerFn(getMenuDetail);
  const reorderSectionsFn = useServerFn(reorderSections);
  const setSectionActiveFn = useServerFn(setSectionActive);

  const [detail, setDetail] = useState<MenuWithContentDTO>(menu);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string>("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MenuSectionDTO | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<MenuSectionDTO | null>(null);

  /** Section id with an in-flight action (rendering disabled state). */
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
      // Stale response guard: a newer reload or menu switch superseded this one.
      if (gen !== genRef.current || !mountedRef.current) return;
      if (res.ok && res.menu) {
        setDetail(res.menu);
        setLoadState("loaded");
        // If a reload reveals the menu became archived, close any open dialogs.
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

  // Fetch getMenuDetail when the panel opens and whenever menu.id changes.
  // Start in loading state; never display a stale snapshot as authoritative.
  useEffect(() => {
    setDetail(menu);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.id]);

  const isArchived = detail.status === "archived";

  function handleCreated() {
    setCreateOpen(false);
    toast.success("Section created.");
    void reload();
  }

  function handleUpdated() {
    setEditOpen(false);
    setEditTarget(null);
    toast.success("Section updated.");
    void reload();
  }

  function handleConflictReload() {
    setEditOpen(false);
    setEditTarget(null);
    void reload();
  }

  async function handleToggleActive(section: MenuSectionDTO) {
    if (isArchived) return;
    // Activation is immediate; deactivation requires confirmation (handled below).
    if (section.isActive) {
      setDeactivateTarget(section);
      return;
    }
    await runAction(section.id, async () => {
      const res: MenuActionResult = await setSectionActiveFn({
        data: { id: section.id, isActive: true, expectedUpdatedAt: section.updatedAt },
      });
      if (res.ok) {
        toast.success("Section activated.");
        void reload();
      } else if (res.kind === "conflict") {
        toast.error("This section was changed by someone else. Reload and try again.");
        void reload();
      } else {
        toast.error(res.message);
        void reload();
      }
    });
  }

  async function confirmDeactivate() {
    const section = deactivateTarget;
    setDeactivateTarget(null);
    if (!section) return;
    await runAction(section.id, async () => {
      const res: MenuActionResult = await setSectionActiveFn({
        data: { id: section.id, isActive: false, expectedUpdatedAt: section.updatedAt },
      });
      if (res.ok) {
        toast.success("Section deactivated.");
        void reload();
      } else if (res.kind === "conflict") {
        toast.error("This section was changed by someone else. Reload and try again.");
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
      const res: MenuActionResult = await reorderSectionsFn({
        data: { menuId: menu.id, orderedIds },
      });
      if (res.ok) {
        toast.success("Sections reordered.");
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Sections could not be reordered.");
    } finally {
      actionLockRef.current = false;
      setReorderPending(false);
      // Always reload authoritative server order — never retain an optimistic
      // order, whether the reorder succeeded or failed.
      void reload();
    }
  }

  /** Run a single-section action with the synchronous double-submit lock. */
  async function runAction(sectionId: string, fn: () => Promise<void>) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setPendingId(sectionId);
    try {
      await fn();
    } catch {
      toast.error("Menu content could not be saved.");
    } finally {
      actionLockRef.current = false;
      setPendingId(null);
    }
  }

  const sections = [...detail.sections].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
            <ArrowLeft className="size-4" aria-hidden />
            Back to menus
          </Button>
          <h2 className="text-xl font-semibold text-foreground">Sections — {detail.name}</h2>
          <p className="text-sm text-muted-foreground">
            Organize the sections guests see on this menu.
          </p>
        </div>
        {!isArchived && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New section
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

      <section aria-label="Section list" aria-live="polite">
        {loadState === "loading" && <LoadingState label="Loading sections…" />}

        {loadState === "error" && (
          <ErrorState
            title="Sections could not be loaded"
            message={loadError || "Please try again."}
            action={
              <Button variant="outline" onClick={() => void reload()}>
                <RefreshCw className="size-4" aria-hidden />
                Try again
              </Button>
            }
          />
        )}

        {loadState === "loaded" && sections.length === 0 && !isArchived && (
          <EmptyState
            title="No sections yet"
            description="Create your first section to group items on this menu."
            icon={<Plus className="size-8" aria-hidden />}
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                New section
              </Button>
            }
          />
        )}

        {loadState === "loaded" && sections.length === 0 && isArchived && (
          <EmptyState
            title="No sections"
            description="This archived menu has no sections."
            icon={<Plus className="size-8" aria-hidden />}
          />
        )}

        {loadState === "loaded" && sections.length > 0 && (
          <SectionTable
            sections={sections}
            onEdit={(s) => {
              setEditTarget(s);
              setEditOpen(true);
            }}
            onToggleActive={handleToggleActive}
            onReorder={handleReorder}
            pendingId={pendingId}
            reorderPending={reorderPending}
            readOnly={isArchived}
          />
        )}

        {loadState === "loaded" && sections.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Deactivating a section hides its assigned items from the public menu. Reordering saves
            the complete list in one step.
          </p>
        )}
      </section>

      {!isArchived && (
        <CreateSectionDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          menuId={menu.id}
          onCreated={handleCreated}
        />
      )}

      <EditSectionDialog
        open={editOpen && !isArchived}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditTarget(null);
        }}
        section={editTarget}
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
            <AlertDialogTitle>Deactivate this section?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget
                ? `“${deactivateTarget.name}” will be hidden from the public menu, along with its assigned items. You can reactivate it later.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDeactivate()}
            >
              Deactivate section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
