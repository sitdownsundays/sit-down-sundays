/**
 * Admin Menus — shared menu metadata form fields.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MENU_LIMITS } from "@/lib/menu/constants";
import type { FormErrors, MenuFormValues } from "./menu-form-helpers";

interface MenuFormProps {
  values: MenuFormValues;
  errors: FormErrors;
  onChange: (patch: Partial<MenuFormValues>) => void;
  disabled?: boolean;
  slugHint?: string;
}

export function MenuForm({ values, errors, onChange, disabled, slugHint }: MenuFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="menu-name">
          Name{" "}
          <span className="text-destructive" aria-hidden>
            *
          </span>
        </Label>
        <Input
          id="menu-name"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "menu-name-error" : undefined}
          maxLength={MENU_LIMITS.menuName}
          disabled={disabled}
          required
        />
        {errors.name && (
          <p id="menu-name-error" className="text-xs text-destructive" role="alert">
            {errors.name}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="menu-slug">
          Slug{" "}
          <span className="text-destructive" aria-hidden>
            *
          </span>
        </Label>
        <Input
          id="menu-slug"
          value={values.slug}
          onChange={(e) => onChange({ slug: e.target.value })}
          aria-invalid={!!errors.slug}
          aria-describedby={errors.slug ? "menu-slug-error" : undefined}
          maxLength={MENU_LIMITS.menuSlug}
          disabled={disabled}
          required
        />
        {slugHint && !errors.slug && <p className="text-xs text-muted-foreground">{slugHint}</p>}
        {errors.slug && (
          <p id="menu-slug-error" className="text-xs text-destructive" role="alert">
            {errors.slug}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="menu-description">Description</Label>
        <Textarea
          id="menu-description"
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
          <p className="text-xs text-destructive" role="alert">
            {errors.description}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="menu-display-order">Display order</Label>
          <Input
            id="menu-display-order"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={values.displayOrder}
            onChange={(e) => onChange({ displayOrder: e.target.value })}
            aria-invalid={!!errors.displayOrder}
            aria-describedby={errors.displayOrder ? "menu-order-error" : undefined}
            disabled={disabled}
          />
          {errors.displayOrder && (
            <p id="menu-order-error" className="text-xs text-destructive" role="alert">
              {errors.displayOrder}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="menu-publish-at">Publish date</Label>
          <Input
            id="menu-publish-at"
            type="datetime-local"
            value={values.publishAt}
            onChange={(e) => onChange({ publishAt: e.target.value })}
            aria-invalid={!!errors.publishAt}
            aria-describedby={errors.publishAt ? "menu-publish-error" : undefined}
            disabled={disabled}
          />
          {errors.publishAt && (
            <p id="menu-publish-error" className="text-xs text-destructive" role="alert">
              {errors.publishAt}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="menu-unpublish-at">Unpublish date</Label>
          <Input
            id="menu-unpublish-at"
            type="datetime-local"
            value={values.unpublishAt}
            onChange={(e) => onChange({ unpublishAt: e.target.value })}
            aria-invalid={!!errors.unpublishAt}
            aria-describedby={errors.unpublishAt ? "menu-unpublish-error" : undefined}
            disabled={disabled}
          />
          {errors.unpublishAt && (
            <p id="menu-unpublish-error" className="text-xs text-destructive" role="alert">
              {errors.unpublishAt}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
