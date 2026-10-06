/**
 * Shared platter create/edit dialog for the ordering configuration screen.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { createSharedPlatter, updateSharedPlatter } from "@/lib/ordering.functions";
import type { SharedPlatterDTO } from "@/lib/ordering/types";
import { Field, centsToDollars, dollarsToCents } from "./ordering-helpers";

interface PlatterDialogProps {
  mode: "create" | "edit";
  existing?: SharedPlatterDTO;
  actionLockRef: React.RefObject<boolean>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function PlatterDialog({
  mode,
  existing,
  actionLockRef,
  onClose,
  onSaved,
}: PlatterDialogProps) {
  const createFn = useServerFn(createSharedPlatter);
  const updateFn = useServerFn(updateSharedPlatter);
  const [name, setName] = useState(existing?.name ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [price, setPrice] = useState(existing ? centsToDollars(existing.pricePerPlatterCents) : "");
  const [servingGuidance, setServingGuidance] = useState(existing?.servingGuidance ?? "");
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [displayOrder, setDisplayOrder] = useState(String(existing?.displayOrder ?? 0));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
        pricePerPlatterCents: priceCents,
        servingGuidance: servingGuidance.trim() || null,
        isActive,
        displayOrder: Number(displayOrder) || 0,
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
      toast.success(mode === "create" ? "Platter created." : "Platter updated.");
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
          <DialogTitle>{mode === "create" ? "New shared platter" : "Edit platter"}</DialogTitle>
          <DialogDescription>Priced per platter, shared by the party.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" error={errors.name} id="plt-name">
            <Input id="plt-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Slug" error={errors.slug} id="plt-slug">
            <Input id="plt-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </Field>
          <Field label="Description" id="plt-desc">
            <Textarea
              id="plt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Price per platter (USD)" error={errors.price} id="plt-price">
            <Input
              id="plt-price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Serving guidance (optional)" id="plt-guidance">
            <Textarea
              id="plt-guidance"
              value={servingGuidance}
              onChange={(e) => setServingGuidance(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Display order" id="plt-order">
              <Input
                id="plt-order"
                type="number"
                min="0"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm pt-6">
              <Switch checked={isActive} onCheckedChange={setIsActive} /> Active
            </label>
          </div>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          {conflict && (
            <p className="text-sm text-destructive">
              This platter was modified by another user.{" "}
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
