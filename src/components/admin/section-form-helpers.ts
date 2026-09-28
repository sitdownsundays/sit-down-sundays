/**
 * Admin Menu Sections — shared helpers (validation, form value types).
 *
 * Framework-independent. No server-only imports.
 */
import type { MenuSectionDTO } from "@/lib/menu/types";
import { MENU_LIMITS } from "@/lib/menu/constants";

export interface SectionFormValues {
  name: string;
  description: string;
  displayOrder: string;
}

export function emptySectionFormValues(): SectionFormValues {
  return { name: "", description: "", displayOrder: "0" };
}

export function sectionToFormValues(section: MenuSectionDTO): SectionFormValues {
  return {
    name: section.name,
    description: section.description ?? "",
    displayOrder: String(section.displayOrder ?? 0),
  };
}

export interface SectionFormErrors {
  name?: string;
  description?: string;
  displayOrder?: string;
}

export function validateSectionForm(v: SectionFormValues): SectionFormErrors {
  const errors: SectionFormErrors = {};
  if (!v.name.trim()) errors.name = "Name is required.";
  else if (v.name.trim().length > MENU_LIMITS.sectionName)
    errors.name = `Name must be ${MENU_LIMITS.sectionName} characters or fewer.`;

  if (v.description.length > MENU_LIMITS.description)
    errors.description = `Description must be ${MENU_LIMITS.description} characters or fewer.`;

  const order = Number(v.displayOrder);
  if (v.displayOrder === "" || Number.isNaN(order) || !Number.isInteger(order) || order < 0)
    errors.displayOrder = "Display order must be a whole number of 0 or more.";

  return errors;
}
