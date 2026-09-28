/**
 * Admin Menu Items — create/edit item form fields.
 *
 * Price is entered as dollars and converted to integer cents by the helpers.
 * Image URL requires meaningful alt text when present; clearing the image
 * permits clearing alt text. Dietary tags and allergens are comma-separated
 * and normalized server-side.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MENU_CATEGORIES, MENU_LIMITS } from "@/lib/menu/constants";
import type { MenuSectionDTO } from "@/lib/menu/types";
import type { ItemFormErrors, ItemFormValues } from "./item-form-helpers";

interface ItemFormProps {
  values: ItemFormValues;
  errors: ItemFormErrors;
  onChange: (patch: Partial<ItemFormValues>) => void;
  sections: MenuSectionDTO[];
  disabled?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  starter: "Starter",
  main: "Main",
  side: "Side",
  dessert: "Dessert",
  beverage: "Beverage",
  children: "Children",
};

export function ItemForm({ values, errors, onChange, sections, disabled }: ItemFormProps) {
  const activeSections = sections.filter((s) => s.isActive);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="item-name">
          Name{" "}
          <span className="text-destructive" aria-hidden>
            *
          </span>
        </Label>
        <Input
          id="item-name"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "item-name-error" : undefined}
          maxLength={MENU_LIMITS.menuItemName}
          disabled={disabled}
          required
        />
        {errors.name && (
          <p id="item-name-error" className="text-xs text-destructive" role="alert">
            {errors.name}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="item-price">
            Price (USD){" "}
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="item-price"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={values.priceDollars}
            onChange={(e) => onChange({ priceDollars: e.target.value })}
            aria-invalid={!!errors.priceDollars}
            aria-describedby={errors.priceDollars ? "item-price-error" : "item-price-help"}
            disabled={disabled}
          />
          {errors.priceDollars ? (
            <p id="item-price-error" className="text-xs text-destructive" role="alert">
              {errors.priceDollars}
            </p>
          ) : (
            <p id="item-price-help" className="text-xs text-muted-foreground">
              Enter dollars, e.g. 12.50.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="item-category">Category</Label>
          <Select
            value={values.category}
            onValueChange={(val) => onChange({ category: val as ItemFormValues["category"] })}
            disabled={disabled}
          >
            <SelectTrigger id="item-category" aria-invalid={!!errors.category}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MENU_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABELS[c] ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.category && (
            <p className="text-xs text-destructive" role="alert">
              {errors.category}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="item-section">Section</Label>
        <Select
          value={values.sectionId || "__unassigned__"}
          onValueChange={(val) => onChange({ sectionId: val === "__unassigned__" ? "" : val })}
          disabled={disabled}
        >
          <SelectTrigger id="item-section" aria-invalid={!!errors.sectionId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassigned__">Unassigned</SelectItem>
            {activeSections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          An item may only be assigned to an active section of this menu.
        </p>
        {errors.sectionId && (
          <p className="text-xs text-destructive" role="alert">
            {errors.sectionId}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="item-description">Description</Label>
        <Textarea
          id="item-description"
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          maxLength={MENU_LIMITS.description}
          disabled={disabled}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          {values.description.length}/{MENU_LIMITS.description}
        </p>
        {errors.description && (
          <p id="item-description-error" className="text-xs text-destructive" role="alert">
            {errors.description}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="item-image-url">Image URL</Label>
          <Input
            id="item-image-url"
            type="url"
            value={values.imageUrl}
            onChange={(e) => onChange({ imageUrl: e.target.value })}
            aria-invalid={!!errors.imageUrl}
            aria-describedby={errors.imageUrl ? "item-image-url-error" : undefined}
            maxLength={MENU_LIMITS.imageUrl}
            disabled={disabled}
          />
          {errors.imageUrl && (
            <p id="item-image-url-error" className="text-xs text-destructive" role="alert">
              {errors.imageUrl}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="item-image-alt">Image alt text</Label>
          <Input
            id="item-image-alt"
            value={values.imageAlt}
            onChange={(e) => onChange({ imageAlt: e.target.value })}
            aria-invalid={!!errors.imageAlt}
            aria-describedby={errors.imageAlt ? "item-image-alt-error" : undefined}
            maxLength={MENU_LIMITS.imageAlt}
            disabled={disabled}
          />
          {errors.imageAlt && (
            <p id="item-image-alt-error" className="text-xs text-destructive" role="alert">
              {errors.imageAlt}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="item-dietary-tags">Dietary tags</Label>
          <Input
            id="item-dietary-tags"
            value={values.dietaryTags}
            onChange={(e) => onChange({ dietaryTags: e.target.value })}
            aria-describedby={errors.dietaryTags ? "item-dietary-error" : "item-dietary-help"}
            disabled={disabled}
          />
          {errors.dietaryTags ? (
            <p id="item-dietary-error" className="text-xs text-destructive" role="alert">
              {errors.dietaryTags}
            </p>
          ) : (
            <p id="item-dietary-help" className="text-xs text-muted-foreground">
              Comma-separated, e.g. vegetarian, gluten-free.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="item-allergens">Allergens</Label>
          <Input
            id="item-allergens"
            value={values.allergens}
            onChange={(e) => onChange({ allergens: e.target.value })}
            aria-describedby={errors.allergens ? "item-allergens-error" : "item-allergens-help"}
            disabled={disabled}
          />
          {errors.allergens ? (
            <p id="item-allergens-error" className="text-xs text-destructive" role="alert">
              {errors.allergens}
            </p>
          ) : (
            <p id="item-allergens-help" className="text-xs text-muted-foreground">
              Comma-separated, e.g. nuts, dairy.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="item-display-order">Display order</Label>
          <Input
            id="item-display-order"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={values.displayOrder}
            onChange={(e) => onChange({ displayOrder: e.target.value })}
            aria-invalid={!!errors.displayOrder}
            aria-describedby={errors.displayOrder ? "item-order-error" : undefined}
            disabled={disabled}
          />
          {errors.displayOrder && (
            <p id="item-order-error" className="text-xs text-destructive" role="alert">
              {errors.displayOrder}
            </p>
          )}
        </div>

        <div className="flex items-end gap-2 pb-2">
          <Checkbox
            id="item-featured"
            checked={values.isFeatured}
            onCheckedChange={(val) => onChange({ isFeatured: val === true })}
            disabled={disabled}
          />
          <Label htmlFor="item-featured" className="cursor-pointer text-sm font-normal">
            Featured item
          </Label>
        </div>
      </div>
    </div>
  );
}
