/**
 * Admin Menu Items — edit-item dialog with optimistic-concurrency handling.
 *
 * On a conflict (stale expectedUpdatedAt), the user's form values are
 * preserved and a reload action is offered instead of silently overwriting
 * newer data. The reload action closes the dialog AND refreshes the latest
 * record from the server.
 */
import { useEffect, useState } from "react";
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
import { updateItem } from "@/lib/menu.functions";
import type { MenuActionResult, MenuItemDTO, MenuSectionDTO } from "@/lib/menu/types";
import { ItemForm } from "./item-form";
import {
  buildPatchPayload,
  emptyItemFormValues,
  itemToFormValues,
  validateItemForm,
  type ItemFormErrors,
  type ItemFormValues,
} from "./item-form-helpers";

interface EditItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: MenuItemDTO | null;
  sections: MenuSectionDTO[];
  onUpdated: () => void;
  /** Conflict recovery: close the dialog and reload the latest record. */
  onConflictReload?: () => void;
}

export function EditItemDialog({
  open,
  onOpenChange,
  item,
  sections,
  onUpdated,
  onConflictReload,
}: EditItemDialogProps) {
  const updateItemFn = useServerFn(updateItem);
  const [values, setValues] = useState<ItemFormValues>(emptyItemFormValues());
  const [errors, setErrors] = useState<ItemFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (open && item) {
      setValues(itemToFormValues(item));
      setErrors({});
      setServerError("");
      setConflict(false);
      setSubmitting(false);
    }
  }, [open, item]);

  function update(patch: Partial<ItemFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    setServerError("");
    setConflict(false);
    const found = validateItemForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const res: MenuActionResult = await updateItemFn({
        data: {
          id: item.id,
          expectedUpdatedAt: item.updatedAt,
          patch: buildPatchPayload(values),
        },
      });
      if (res.ok) {
        onUpdated();
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit menu item</DialogTitle>
          <DialogDescription>
            {item ? <>Editing “{item.name}”.</> : "Edit item details."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ItemForm
            values={values}
            errors={errors}
            onChange={update}
            sections={sections}
            disabled={submitting}
          />

          {conflict ? (
            <div
              className="rounded-md border border-warning/40 bg-warning/10 p-3"
              role="alert"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-warning-foreground">
                This item was changed by someone else.
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
