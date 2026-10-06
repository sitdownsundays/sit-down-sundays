/**
 * Package create/edit dialog for the ordering configuration screen.
 *
 * Includes eligible-dish pickers that reuse existing catalog menu_items,
 * separated by selection category (meats / sides / bread / drink). Saving
 * replaces the package's eligible-item set through the authorized server
 * function and reloads the configuration.
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createMealPackage, updateMealPackage } from "@/lib/ordering.functions";
import { listAllMenus } from "@/lib/menu.functions";
import type { MealPackageDTO } from "@/lib/ordering/types";
import type { SelectionCategory } from "@/lib/ordering/constants";
import { SELECTION_CATEGORY_LABELS } from "@/lib/ordering/constants";
import { Field, centsToDollars, dollarsToCents } from "./ordering-helpers";

interface PackageDialogProps {
  mode: "create" | "edit";
  existing?: MealPackageDTO;
  actionLockRef: React.RefObject<boolean>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/** A flat catalog item for the eligible-dish picker. */
type CatalogItem = { id: string; name: string; menuName: string };

const SELECTION_CATS: SelectionCategory[] = ["meat", "side", "bread", "drink"];

export function PackageDialog({
  mode,
  existing,
  actionLockRef,
  onClose,
  onSaved,
}: PackageDialogProps) {
  const createFn = useServerFn(createMealPackage);
  const updateFn = useServerFn(updateMealPackage);

  // Load the full menu catalog (all menus + items) for the eligible-dish picker.
  const catalogQuery = useQuery({
    queryKey: ["admin-menus-all"],
    queryFn: async () => {
      const res = await listAllMenus();
      if (!res.ok) return [];
      return res.menus;
    },
  });

  const catalogItems: CatalogItem[] = useMemo(() => {
    const menus = catalogQuery.data ?? [];
    const out: CatalogItem[] = [];
    for (const m of menus) {
      for (const it of m.items) {
        out.push({ id: it.id, name: it.name, menuName: m.name });
      }
    }
    return out;
  }, [catalogQuery.data]);

  const [name, setName] = useState(existing?.name ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [price, setPrice] = useState(existing ? centsToDollars(existing.pricePerPersonCents) : "");
  const [meats, setMeats] = useState(String(existing?.includedMeatsCount ?? 2));
  const [sides, setSides] = useState(String(existing?.includedSidesCount ?? 2));
  const [includesBread, setIncludesBread] = useState(existing?.includesBread ?? true);
  const [includesSoftDrink, setIncludesSoftDrink] = useState(existing?.includesSoftDrink ?? true);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [displayOrder, setDisplayOrder] = useState(String(existing?.displayOrder ?? 0));

  // Eligible items keyed by selection category -> Set<menuItemId>.
  const [eligible, setEligible] = useState<Record<SelectionCategory, Set<string>>>(() => {
    const init: Record<SelectionCategory, Set<string>> = {
      meat: new Set(),
      side: new Set(),
      bread: new Set(),
      drink: new Set(),
    };
    if (existing) {
      for (const e of existing.eligibleItems) {
        if (init[e.selectionCategory]) init[e.selectionCategory].add(e.menuItemId);
      }
    }
    return init;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function toggleEligible(cat: SelectionCategory, itemId: string) {
    setEligible((prev) => {
      const next = { ...prev, [cat]: new Set(prev[cat]) };
      if (next[cat].has(itemId)) next[cat].delete(itemId);
      else next[cat].add(itemId);
      return next;
    });
  }

  async function submit() {
    if (actionLockRef.current) return;
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required.";
    if (!slug.trim()) e.slug = "Slug is required.";
    const priceCents = dollarsToCents(price);
    if (!Number.isFinite(priceCents) || priceCents < 0) e.price = "Enter a valid price.";
    const meatsN = Number(meats);
    const sidesN = Number(sides);
    if (!Number.isInteger(meatsN) || meatsN < 0) e.meats = "Enter a whole number.";
    if (!Number.isInteger(sidesN) || sidesN < 0) e.sides = "Enter a whole number.";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    actionLockRef.current = true;
    setSubmitting(true);
    setServerError("");
    setConflict(false);
    try {
      const eligibleItems = SELECTION_CATS.flatMap((cat) =>
        Array.from(eligible[cat]).map((menuItemId) => ({
          menuItemId,
          selectionCategory: cat,
        })),
      );
      const payload = {
        name: name.trim(),
        slug: slug.trim(),
        description,
        pricePerPersonCents: priceCents,
        includedMeatsCount: meatsN,
        includedSidesCount: sidesN,
        includesBread,
        includesSoftDrink,
        isActive,
        displayOrder: Number(displayOrder) || 0,
        eligibleItems,
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
      toast.success(mode === "create" ? "Package created." : "Package updated.");
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New meal package" : "Edit package"}</DialogTitle>
          <DialogDescription>
            Package price is per person and covers the included selection counts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" error={errors.name} id="pkg-name">
            <Input id="pkg-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Slug" error={errors.slug} id="pkg-slug">
            <Input id="pkg-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </Field>
          <Field label="Description" id="pkg-desc">
            <Textarea
              id="pkg-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Price per person (USD)" error={errors.price} id="pkg-price">
            <Input
              id="pkg-price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Included meats count" error={errors.meats} id="pkg-meats">
              <Input
                id="pkg-meats"
                type="number"
                min="0"
                value={meats}
                onChange={(e) => setMeats(e.target.value)}
              />
            </Field>
            <Field label="Included sides count" error={errors.sides} id="pkg-sides">
              <Input
                id="pkg-sides"
                type="number"
                min="0"
                value={sides}
                onChange={(e) => setSides(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includesBread} onCheckedChange={(v) => setIncludesBread(!!v)} />
              Includes bread / rolls
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includesSoftDrink}
                onCheckedChange={(v) => setIncludesSoftDrink(!!v)}
              />
              Includes soft drink
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Display order" id="pkg-order">
              <Input
                id="pkg-order"
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

          {/* Eligible dishes */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h4 className="font-medium text-foreground">Eligible dishes</h4>
              <p className="text-sm text-muted-foreground">
                Choose which catalog dishes a guest may pick for each included selection. These are
                covered by the package price and never charged again.
              </p>
            </div>
            {catalogQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading catalog…</p>
            )}
            {catalogQuery.isError && (
              <p className="text-sm text-destructive">Couldn't load the menu catalog.</p>
            )}
            {catalogItems.length === 0 && !catalogQuery.isLoading && (
              <p className="text-sm text-muted-foreground">
                No menu items found. Create menu items in the Menu CMS first.
              </p>
            )}
            {catalogItems.length > 0 && (
              <div className="space-y-4">
                {SELECTION_CATS.map((cat) => (
                  <div key={cat} className="space-y-1.5">
                    <Label className="text-sm font-medium">{SELECTION_CATEGORY_LABELS[cat]}</Label>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {catalogItems.map((item) => {
                        const checked = eligible[cat].has(item.id);
                        return (
                          <label
                            key={item.id}
                            className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleEligible(cat, item.id)}
                            />
                            <span className="flex-1 text-foreground">{item.name}</span>
                            <span className="text-xs text-muted-foreground">{item.menuName}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          {conflict && (
            <p className="text-sm text-destructive">
              This package was modified by another user.{" "}
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
