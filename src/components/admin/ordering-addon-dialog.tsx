/**
 * Individual add-on create/edit dialog for the ordering configuration screen.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createIndividualAddon, updateIndividualAddon } from "@/lib/ordering.functions";
import type { IndividualAddonDTO, MealPackageDTO } from "@/lib/ordering/types";
import { Field, centsToDollars, dollarsToCents } from "./ordering-helpers";

interface AddonDialogProps {
  mode: "create" | "edit";
  existing?: IndividualAddonDTO;
  packages: MealPackageDTO[];
  actionLockRef: React.RefObject<boolean>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function AddonDialog({
  mode,
  existing,
  packages,
  actionLockRef,
  onClose,
  onSaved,
}: AddonDialogProps) {
  const createFn = useServerFn(createIndividualAddon);
  const updateFn = useServerFn(updateIndividualAddon);
  const [name, setName] = useState(existing?.name ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [price, setPrice] = useState(existing ? centsToDollars(existing.priceCents) : "");
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [displayOrder, setDisplayOrder] = useState(String(existing?.displayOrder ?? 0));
  const [eligiblePackageIds, setEligiblePackageIds] = useState<string[]>(
    existing?.eligiblePackageIds ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function togglePackage(id: string) {
    setEligiblePackageIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  async function submit() {
    if (actionLockRef.current) return;
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required.";
    if (!slug.trim()) e.slug = "Slug is required.";
    const priceCents = dollarsToCents(price);
    if (!Number.isFinite(priceCents) || priceCents < 0) e.price = "Enter a valid price.";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    actionLockRef.current = true;
    setSubmitting(true);
    setServerError("");
    setConflict(false);
    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim(),
        description,
        priceCents,
        isActive,
        displayOrder: Number(displayOrder) || 0,
        eligiblePackageIds,
      };
      const result =
        mode === "create"
          ? await createFn({ data: payload })
          : await updateFn({
              data: { ...payload, id: existing!.id, expectedUpdatedAt: existing!.updatedAt },
            });
      if (!result.success) {
        if (result.conflict) setConflict(true);
        else setServerError(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(mode === "create" ? "Add-on created." : "Add-on updated.");
      await onSaved();
      onClose();
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      actionLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New individual add-on" : "Edit add-on"}</DialogTitle>
          <DialogDescription>Priced per unit, attached to one guest.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" error={errors.name} id="addon-name">
            <Input id="addon-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Slug" error={errors.slug} id="addon-slug">
            <Input id="addon-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </Field>
          <Field label="Description" id="addon-desc">
            <Textarea
              id="addon-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Price per unit (USD)" error={errors.price} id="addon-price">
            <Input
              id="addon-price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Display order" id="addon-order">
            <Input
              id="addon-order"
              type="number"
              min="0"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={setIsActive} /> Active
          </label>
          <div>
            <p className="text-sm font-medium text-foreground">Eligible packages</p>
            <p className="text-xs text-muted-foreground">
              Leave all unchecked to make this add-on eligible for every package.
            </p>
            <div className="mt-2 space-y-2">
              {packages.length === 0 && (
                <p className="text-xs text-muted-foreground">No packages available yet.</p>
              )}
              {packages.map((pkg) => (
                <label key={pkg.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={eligiblePackageIds.includes(pkg.id)}
                    onCheckedChange={() => togglePackage(pkg.id)}
                  />
                  {pkg.name}
                </label>
              ))}
            </div>
          </div>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          {conflict && (
            <p className="text-sm text-destructive">
              This add-on was modified by another user.{" "}
              <button
                className="underline"
                onClick={async () => {
                  await onSaved();
                  onClose();
                }}
              >
                Reload latest
              </button>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
