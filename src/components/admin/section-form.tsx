/**
 * Admin Menu Sections — shared section metadata form fields.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MENU_LIMITS } from "@/lib/menu/constants";
import type { SectionFormErrors, SectionFormValues } from "./section-form-helpers";

interface SectionFormProps {
  values: SectionFormValues;
  errors: SectionFormErrors;
  onChange: (patch: Partial<SectionFormValues>) => void;
  disabled?: boolean;
}

export function SectionForm({ values, errors, onChange, disabled }: SectionFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="section-name">
          Name{" "}
          <span className="text-destructive" aria-hidden>
            *
          </span>
        </Label>
        <Input
          id="section-name"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "section-name-error" : undefined}
          maxLength={MENU_LIMITS.sectionName}
          disabled={disabled}
          required
        />
        {errors.name && (
          <p id="section-name-error" className="text-xs text-destructive" role="alert">
            {errors.name}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="section-description">Description</Label>
        <Textarea
          id="section-description"
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
          <p id="section-description-error" className="text-xs text-destructive" role="alert">
            {errors.description}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="section-display-order">Display order</Label>
        <Input
          id="section-display-order"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={values.displayOrder}
          onChange={(e) => onChange({ displayOrder: e.target.value })}
          aria-invalid={!!errors.displayOrder}
          aria-describedby={errors.displayOrder ? "section-order-error" : undefined}
          disabled={disabled}
        />
        {errors.displayOrder && (
          <p id="section-order-error" className="text-xs text-destructive" role="alert">
            {errors.displayOrder}
          </p>
        )}
      </div>
    </div>
  );
}
