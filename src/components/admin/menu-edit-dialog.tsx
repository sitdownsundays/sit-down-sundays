/**
 * Admin Menus — edit-menu metadata dialog with optimistic-concurrency handling.
 *
 * Status is intentionally NOT editable here. On a conflict (stale
 * expectedUpdatedAt), the user's form values are preserved and a reload
 * action is offered instead of silently overwriting newer data. The reload
 * action closes the dialog AND refreshes the latest record from the server.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateMenu } from "@/lib/menu.functions";
import { normalizeSlug } from "@/lib/menu/constants";
import type { MenuActionResult, MenuWithContentDTO } from "@/lib/menu/types";
import { MenuForm } from "./menu-form";
import {
  emptyFormValues,
  fromDatetimeLocalValue,
  menuToFormValues,
  validateForm,
  type FormErrors,
  type MenuFormValues,
} from "./menu-form-helpers";

interface EditMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu: MenuWithContentDTO | null;
  onUpdated: (menu: MenuWithContentDTO) => void;
  /** Conflict recovery: close the dialog and reload the latest record. */
  onConflictReload?: () => void;
}

export function EditMenuDialog({
  open,
  onOpenChange,
  menu,
  onUpdated,
  onConflictReload,
}: EditMenuDialogProps) {
  const updateMenuFn = useServerFn(updateMenu);
  const [values, setValues] = useState<MenuFormValues>(emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (open && menu) {
      setValues(menuToFormValues(menu));
      setErrors({});
      setServerError("");
      setConflict(false);
      setSubmitting(false);
    }
  }, [open, menu]);

  function update(patch: Partial<MenuFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!menu) return;
    setServerError("");
    setConflict(false);
    const v = values;
    const found = validateForm(v);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const res: MenuActionResult = await updateMenuFn({
        data: {
          id: menu.id,
          expectedUpdatedAt: menu.updatedAt,
          patch: {
            name: v.name.trim(),
            slug: normalizeSlug(v.slug),
            description: v.description.trim(),
            displayOrder: Number(v.displayOrder),
            publishAt: fromDatetimeLocalValue(v.publishAt),
            unpublishAt: fromDatetimeLocalValue(v.unpublishAt),
          },
        },
      });
      if (res.ok) {
        onUpdated(menu);
      } else if (res.kind === "conflict") {
        setConflict(true);
        setServerError(res.message);
      } else {
        setServerError(res.message);
      }
    } catch {
      setServerError("Menu content could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit menu</DialogTitle>
          <DialogDescription>
            {menu ? (
              <>Editing “{menu.name}”. Status cannot be changed here — use Publish or Archive.</>
            ) : (
              "Edit menu metadata."
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <MenuForm values={values} errors={errors} onChange={update} disabled={submitting} />
          </div>

          {conflict ? (
            <div
              className="rounded-md border border-warning/40 bg-warning/10 p-3"
              role="alert"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-warning-foreground">
                This menu was changed by someone else.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your edits are preserved. Reload the latest version to avoid overwriting newer
                changes.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => (onConflictReload ? onConflictReload() : onOpenChange(false))}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Reload latest
              </Button>
            </div>
          ) : serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
