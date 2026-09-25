/**
 * Admin Menus — create-menu dialog.
 *
 * New menus always start as drafts. The create payload never includes a
 * status field — the server schema rejects it and the repository forces
 * "draft". When the user edits the slug field, it is marked as manually
 * edited so subsequent name edits do not overwrite the custom slug.
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
import { createMenu } from "@/lib/menu.functions";
import { normalizeSlug } from "@/lib/menu/constants";
import type { MenuActionResult } from "@/lib/menu/types";
import { MenuForm } from "./menu-form";
import {
  emptyFormValues,
  fromDatetimeLocalValue,
  validateForm,
  type FormErrors,
  type MenuFormValues,
} from "./menu-form-helpers";

interface CreateMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateMenuDialog({ open, onOpenChange, onCreated }: CreateMenuDialogProps) {
  const createMenuFn = useServerFn(createMenu);
  const [values, setValues] = useState<MenuFormValues>(emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(emptyFormValues());
      setErrors({});
      setServerError("");
      setSlugTouched(false);
      setSubmitting(false);
      requestAnimationFrame(() => {
        const el = document.getElementById("menu-name");
        if (el instanceof HTMLElement) el.focus();
      });
    }
  }, [open]);

  function update(patch: Partial<MenuFormValues>) {
    // When the user edits the slug directly, mark it as manually edited so
    // subsequent name edits do not overwrite the custom slug.
    if ("slug" in patch) setSlugTouched(true);
    setValues((prev) => {
      const next = { ...prev, ...patch };
      if ("name" in patch && !slugTouched) {
        next.slug = normalizeSlug(patch.name ?? prev.name);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    const v = values;
    const found = validateForm(v);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const res: MenuActionResult = await createMenuFn({
        data: {
          name: v.name.trim(),
          slug: normalizeSlug(v.slug),
          description: v.description.trim(),
          displayOrder: Number(v.displayOrder),
          publishAt: fromDatetimeLocalValue(v.publishAt),
          unpublishAt: fromDatetimeLocalValue(v.unpublishAt),
        },
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a draft menu</DialogTitle>
          <DialogDescription>
            New menus start as drafts. You can publish a menu once it has at least one active item.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <MenuForm
              values={values}
              errors={errors}
              onChange={update}
              disabled={submitting}
              slugHint="Lowercase letters, numbers, and hyphens. Used in the public menu URL."
            />
          </div>
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
              {submitting ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
