/**
 * Admin Menu Items — create-item dialog.
 *
 * Focuses the name input on open. Validation runs client-side before
 * submission; the server re-validates authoritatively. A new item is always
 * active (forced server-side).
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createItem } from "@/lib/menu.functions";
import type { MenuActionResult, MenuSectionDTO } from "@/lib/menu/types";
import { ItemForm } from "./item-form";
import {
  buildCreatePayload,
  emptyItemFormValues,
  validateItemForm,
  type ItemFormErrors,
  type ItemFormValues,
} from "./item-form-helpers";

interface CreateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuId: string;
  sections: MenuSectionDTO[];
  onCreated: () => void;
}

export function CreateItemDialog({
  open,
  onOpenChange,
  menuId,
  sections,
  onCreated,
}: CreateItemDialogProps) {
  const createItemFn = useServerFn(createItem);
  const [values, setValues] = useState<ItemFormValues>(emptyItemFormValues());
  const [errors, setErrors] = useState<ItemFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>("");

  useEffect(() => {
    if (open) {
      setValues(emptyItemFormValues());
      setErrors({});
      setServerError("");
      setSubmitting(false);
      requestAnimationFrame(() => {
        const el = document.getElementById("item-name");
        if (el instanceof HTMLElement) el.focus();
      });
    }
  }, [open]);

  function update(patch: Partial<ItemFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    const found = validateItemForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const res: MenuActionResult = await createItemFn({
        data: buildCreatePayload(values, menuId),
      });
      if (res.ok) {
        onCreated();
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
          <DialogTitle>New menu item</DialogTitle>
          <DialogDescription>
            Add an item to this menu. New items are active by default.
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

          {serverError && (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          )}

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
              {submitting ? "Saving…" : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
