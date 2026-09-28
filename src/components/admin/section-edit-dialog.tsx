/**
 * Admin Menu Sections — edit-section dialog with optimistic-concurrency handling.
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
import { updateSection } from "@/lib/menu.functions";
import type { MenuActionResult, MenuSectionDTO } from "@/lib/menu/types";
import { SectionForm } from "./section-form";
import {
  emptySectionFormValues,
  sectionToFormValues,
  validateSectionForm,
  type SectionFormErrors,
  type SectionFormValues,
} from "./section-form-helpers";

interface EditSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: MenuSectionDTO | null;
  onUpdated: () => void;
  /** Conflict recovery: close the dialog and reload the latest record. */
  onConflictReload?: () => void;
}

export function EditSectionDialog({
  open,
  onOpenChange,
  section,
  onUpdated,
  onConflictReload,
}: EditSectionDialogProps) {
  const updateSectionFn = useServerFn(updateSection);
  const [values, setValues] = useState<SectionFormValues>(emptySectionFormValues());
  const [errors, setErrors] = useState<SectionFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string>("");
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (open && section) {
      setValues(sectionToFormValues(section));
      setErrors({});
      setServerError("");
      setConflict(false);
      setSubmitting(false);
    }
  }, [open, section]);

  function update(patch: Partial<SectionFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!section) return;
    setServerError("");
    setConflict(false);
    const found = validateSectionForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const res: MenuActionResult = await updateSectionFn({
        data: {
          id: section.id,
          expectedUpdatedAt: section.updatedAt,
          patch: {
            name: values.name.trim(),
            description: values.description.trim(),
            displayOrder: Number(values.displayOrder),
          },
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit section</DialogTitle>
          <DialogDescription>
            {section ? <>Editing “{section.name}”.</> : "Edit section metadata."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <SectionForm values={values} errors={errors} onChange={update} disabled={submitting} />

          {conflict ? (
            <div
              className="rounded-md border border-warning/40 bg-warning/10 p-3"
              role="alert"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-warning-foreground">
                This section was changed by someone else.
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
