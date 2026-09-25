/**
 * Admin Menu Management UI — Phase 3A3A.
 *
 * Menu-level administration only at /admin/menus:
 *  - List menus (name, slug, status, publish/unpublish window, item count,
 *    last-updated) with loading / empty / error / success states.
 *  - Create a draft menu.
 *  - Edit menu metadata only (name, slug, description, display order,
 *    publish date, unpublish date). Status is NEVER editable here.
 *  - Publish via publishMenu (publishing-rule failures shown clearly).
 *  - Archive via archiveMenu with confirmation.
 *  - No hard deletion. No direct status editing.
 *  - Optimistic-concurrency conflicts preserve form values + offer reload.
 *  - Publish/Archive actions are disabled while pending to prevent
 *    double-submits. Archived menus cannot be edited, published, or restored.
 *
 * Authorization is enforced server-side by the server functions
 * (resolveMenuActor + hasMutationRole / hasDraftReadRole). This UI only
 * gates presentation; it never trusts a browser-supplied role.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";

import { archiveMenu, listAllMenus, publishMenu } from "@/lib/menu.functions";
import type { MenuActionResult, MenuListResult, MenuWithContentDTO } from "@/lib/menu/types";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
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
import { MenuTable } from "./menu-table";
import { CreateMenuDialog } from "./menu-create-dialog";
import { EditMenuDialog } from "./menu-edit-dialog";

export function AdminMenusPage() {
  const listAllMenusFn = useServerFn(listAllMenus);
  const publishMenuFn = useServerFn(publishMenu);
  const archiveMenuFn = useServerFn(archiveMenu);

  const [menus, setMenus] = useState<MenuWithContentDTO[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [loadError, setLoadError] = useState<string>("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MenuWithContentDTO | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<MenuWithContentDTO | null>(null);
  /** Menu id with an in-flight publish/archive action (rendering disabled state). */
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** Synchronous lock: checked and set before awaiting to prevent double-submits. */
  const actionLockRef = useRef(false);

  const reload = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const res: MenuListResult = await listAllMenusFn();
      if (res.ok) {
        setMenus(res.menus);
        setLoadState("loaded");
      } else {
        setLoadError(res.message);
        setLoadState("error");
      }
    } catch {
      setLoadError("Menu content could not be loaded.");
      setLoadState("error");
    }
  }, [listAllMenusFn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function handleCreated() {
    setCreateOpen(false);
    toast.success("Draft menu created.");
    void reload();
  }

  function handleUpdated(menu: MenuWithContentDTO) {
    setEditTarget(menu);
    setEditOpen(false);
    toast.success("Menu updated.");
    void reload();
  }

  /** Close the edit dialog and refresh the latest record (conflict recovery). */
  function handleConflictReload() {
    setEditOpen(false);
    setEditTarget(null);
    void reload();
  }

  async function handlePublish(menu: MenuWithContentDTO) {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setPendingId(menu.id);
    try {
      const res: MenuActionResult = await publishMenuFn({ data: { id: menu.id } });
      if (res.ok) {
        toast.success("Menu published.");
        void reload();
      } else if (res.kind === "conflict") {
        toast.error("This menu was changed by someone else. Reload and try again.");
        void reload();
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Menu content could not be saved.");
    } finally {
      actionLockRef.current = false;
      setPendingId(null);
    }
  }

  async function handleArchive(menu: MenuWithContentDTO) {
    setArchiveTarget(null);
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setPendingId(menu.id);
    try {
      const res: MenuActionResult = await archiveMenuFn({ data: { id: menu.id } });
      if (res.ok) {
        toast.success("Menu archived.");
        void reload();
      } else if (res.kind === "conflict") {
        toast.error("This menu was changed by someone else. Reload and try again.");
        void reload();
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Menu content could not be saved.");
    } finally {
      actionLockRef.current = false;
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Menus"
        description="Create, edit, publish, and archive the menus guests see on the public site."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New menu
          </Button>
        }
      />

      <section aria-label="Menu list" aria-live="polite">
        {loadState === "loading" && <LoadingState label="Loading menus…" />}

        {loadState === "error" && (
          <ErrorState
            title="Menus could not be loaded"
            message={loadError || "Please try again."}
            action={
              <Button variant="outline" onClick={() => void reload()}>
                <RefreshCw className="size-4" aria-hidden />
                Try again
              </Button>
            }
          />
        )}

        {loadState === "loaded" && menus.length === 0 && (
          <EmptyState
            title="No menus yet"
            description="Create your first draft menu to get started."
            icon={<Plus className="size-8" aria-hidden />}
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                New menu
              </Button>
            }
          />
        )}

        {loadState === "loaded" && menus.length > 0 && (
          <MenuTable
            menus={menus}
            onEdit={(m) => {
              setEditTarget(m);
              setEditOpen(true);
            }}
            onPublish={handlePublish}
            onArchive={(m) => setArchiveTarget(m)}
            pendingId={pendingId}
          />
        )}
      </section>

      <CreateMenuDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      <EditMenuDialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditTarget(null);
        }}
        menu={editTarget}
        onUpdated={handleUpdated}
        onConflictReload={handleConflictReload}
      />

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => {
          if (!o) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this menu?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget
                ? `“${archiveTarget.name}” will be archived and hidden from the public site. Archived menus cannot be republished. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => archiveTarget && void handleArchive(archiveTarget)}
            >
              Archive menu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
