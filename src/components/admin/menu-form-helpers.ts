/**
 * Admin Menus — shared helpers (formatting, validation, form value types).
 *
 * Framework-independent. No server-only imports.
 */
import type { MenuWithContentDTO } from "@/lib/menu/types";
import type { MenuStatus } from "@/lib/menu/constants";
import { MENU_LIMITS, normalizeSlug } from "@/lib/menu/constants";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function statusTone(status: MenuStatus): StatusTone {
  switch (status) {
    case "published":
      return "success";
    case "archived":
      return "neutral";
    default:
      return "info";
  }
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

/** Convert an ISO string to the value format <input type="datetime-local"> expects. */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

/** Convert a datetime-local value back to an ISO string (or null when blank). */
export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export interface MenuFormValues {
  name: string;
  slug: string;
  description: string;
  displayOrder: string;
  publishAt: string;
  unpublishAt: string;
}

export function emptyFormValues(): MenuFormValues {
  return {
    name: "",
    slug: "",
    description: "",
    displayOrder: "0",
    publishAt: "",
    unpublishAt: "",
  };
}

export function menuToFormValues(menu: MenuWithContentDTO): MenuFormValues {
  return {
    name: menu.name,
    slug: menu.slug,
    description: menu.description ?? "",
    displayOrder: String(menu.displayOrder ?? 0),
    publishAt: toDatetimeLocalValue(menu.publishAt),
    unpublishAt: toDatetimeLocalValue(menu.unpublishAt),
  };
}

export interface FormErrors {
  name?: string;
  slug?: string;
  description?: string;
  displayOrder?: string;
  publishAt?: string;
  unpublishAt?: string;
}

export function validateForm(v: MenuFormValues): FormErrors {
  const errors: FormErrors = {};
  if (!v.name.trim()) errors.name = "Name is required.";
  else if (v.name.trim().length > MENU_LIMITS.menuName)
    errors.name = `Name must be ${MENU_LIMITS.menuName} characters or fewer.`;

  const normalizedSlug = normalizeSlug(v.slug);
  if (!normalizedSlug) errors.slug = "Slug is required.";
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug))
    errors.slug = "Use lowercase letters, numbers, and single hyphens only.";
  else if (normalizedSlug.length > MENU_LIMITS.menuSlug)
    errors.slug = `Slug must be ${MENU_LIMITS.menuSlug} characters or fewer.`;

  if (v.description.length > MENU_LIMITS.description)
    errors.description = `Description must be ${MENU_LIMITS.description} characters or fewer.`;

  const order = Number(v.displayOrder);
  if (v.displayOrder === "" || Number.isNaN(order) || !Number.isInteger(order) || order < 0)
    errors.displayOrder = "Display order must be a whole number of 0 or more.";

  const pubIso = fromDatetimeLocalValue(v.publishAt);
  const unpubIso = fromDatetimeLocalValue(v.unpublishAt);
  if (pubIso && unpubIso && new Date(unpubIso) <= new Date(pubIso)) {
    errors.unpublishAt = "Unpublish date must be later than the publish date.";
  }

  return errors;
}
