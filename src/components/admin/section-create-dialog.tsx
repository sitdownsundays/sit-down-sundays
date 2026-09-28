/**
 * Admin Menu Sections — create-section dialog.
 *
 * Focuses the name input on open. Validation runs client-side before
 * submission; the server re-validates authoritatively.
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
import { createSection } from "@/lib/menu.functions";
import type { MenuActionResult } from "@/lib/menu/types";
import { SectionForm } from "./section-form";
import {
  emptySectionFormValues,
  validateSectionForm,
  type SectionFormErrors,
  type SectionFormValues,
} from "./section-form-helpers";

interface CreateSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuId: string;
  onCreated: () => void;
}

export function CreateSectionDialog({
  open,
  onOpenChange,
  menuId,
  onCreated,
}: CreateSectionDialogProps) {
  const createSectionFn = useServerFn(createSection);
  const [values, setValues] = useState<SectionFormValues>(emptySectionFormValues());
  const [errors, setErrors] = useState<SectionFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>("");

  useEffect(() => {
    if (open) {
      setValues(emptySectionFormValues());
      setErrors({});
      setServerError("");
      setSubmitting(false);
      requestAnimationFrame(() => {
        const el = document.getElementById("section-name");
        if (el instanceof HTMLElement) el.focus();
      });
    }
  }, [open]);

  function update(patch: Partial<SectionFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    const found = validateSectionForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const res: MenuActionResult = await createSectionFn({
        data: {
          menuId,
          name: values.name.trim(),
          description: values.description.trim(),
          displayOrder: Number(values.displayOrder),
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
          <DialogTitle>Create a section</DialogTitle>
          <DialogDescription>
            Sections group related items on the menu. New sections are active by default.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <SectionForm values={values} errors={errors} onChange={update} disabled={submitting} />
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
              {submitting ? "Creating…" : "Create section"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
