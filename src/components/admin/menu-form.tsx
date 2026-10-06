/**
 * Admin Menus — shared menu metadata form fields.
 *
 * Scheduling is rendered in a dedicated optional "Publication schedule"
 * section, separate from display order. Each boundary uses a calendar date
 * picker + a separate time selector (ScheduleField), with a Clear action and
 * a timezone label. Scheduling never changes draft status; publishing is a
 * separate action.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MENU_LIMITS } from "@/lib/menu/constants";
import { ScheduleField, type ScheduleBoundaryValue } from "./schedule-field";
import type { FormErrors, MenuFormValues } from "./menu-form-helpers";

interface MenuFormProps {
  values: MenuFormValues;
  errors: FormErrors;
  onChange: (patch: Partial<MenuFormValues>) => void;
  disabled?: boolean;
  slugHint?: string;
  /** Display label for the timezone entered schedule values are interpreted in. */
  timezoneLabel: string;
}

export function MenuForm({
  values,
  errors,
  onChange,
  disabled,
  slugHint,
  timezoneLabel,
}: MenuFormProps) {
  return (
    <div className="space-y-6">
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
      </div>

      {/* ----------------------- Publication schedule ----------------------- */}
      <fieldset
        className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4"
        disabled={disabled}
      >
        <legend className="px-1 text-sm font-semibold">Publication schedule (optional)</legend>
        <p className="text-xs text-muted-foreground">
          These control when this menu is visible on the public website — not reservation dates or
          seating times. Either boundary may be left unset. Scheduling does not publish a menu;
          publishing is a separate action.
        </p>

        <ScheduleField
          id="menu-publish-at"
          label="Show on website from"
          value={values.publishAt}
          onChange={(b: ScheduleBoundaryValue) => onChange({ publishAt: b })}
          error={errors.publishAt}
          timezoneLabel={timezoneLabel}
          disabled={disabled}
        />

        <ScheduleField
          id="menu-unpublish-at"
          label="Hide from website after"
          value={values.unpublishAt}
          onChange={(b: ScheduleBoundaryValue) => onChange({ unpublishAt: b })}
          error={errors.unpublishAt}
          timezoneLabel={timezoneLabel}
          disabled={disabled}
        />
      </fieldset>
    </div>
  );
}
