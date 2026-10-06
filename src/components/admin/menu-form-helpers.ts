/**
 * Admin Menus — shared helpers (formatting, validation, form value types).
 *
 * Framework-independent. No server-only imports.
 */
import type { MenuWithContentDTO } from "@/lib/menu/types";
import type { MenuStatus } from "@/lib/menu/constants";
import { MENU_LIMITS, normalizeSlug } from "@/lib/menu/constants";
import type { ScheduleBoundaryValue } from "./schedule-field";

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

/* ----------------------- Schedule boundary conversion ----------------------- */

/**
 * Convert an ISO timestamp to a split schedule boundary (local date + time).
 * Returns an empty boundary when the input is null/invalid.
 */
export function isoToScheduleBoundary(iso: string | null): ScheduleBoundaryValue {
  if (!iso) return { date: "", time: "" };
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { date: "", time: "" };
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  } catch {
    return { date: "", time: "" };
  }
}

/**
 * Convert a split schedule boundary to an ISO timestamp (or null when unset).
 * Returns null when both date and time are empty. Returns null when only a
 * partial value is present — the caller validates completeness and surfaces
 * an inline error rather than silently discarding a partial value.
 */
export function scheduleBoundaryToIso(b: ScheduleBoundaryValue): string | null {
  if (!b.date && !b.time) return null;
  if (!b.date || !b.time) return null; // incomplete — caller must validate
  try {
    const d = new Date(`${b.date}T${b.time}`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/** True when a boundary has a date but no time (or vice versa). */
export function isBoundaryIncomplete(b: ScheduleBoundaryValue): boolean {
  return (!!b.date && !b.time) || (!b.date && !!b.time);
}

/** Detect the browser's local IANA timezone, if available. */
export function browserTimezoneLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    /* ignore */
  }
  return "your local time";
}

/* ----------------------------- Form value types ----------------------------- */

export interface MenuFormValues {
  name: string;
  slug: string;
  description: string;
  displayOrder: string;
  publishAt: ScheduleBoundaryValue;
  unpublishAt: ScheduleBoundaryValue;
}

export function emptyFormValues(): MenuFormValues {
  return {
    name: "",
    slug: "",
    description: "",
    displayOrder: "0",
    publishAt: { date: "", time: "" },
    unpublishAt: { date: "", time: "" },
  };
}

export function menuToFormValues(menu: MenuWithContentDTO): MenuFormValues {
  return {
    name: menu.name,
    slug: menu.slug,
    description: menu.description ?? "",
    displayOrder: String(menu.displayOrder ?? 0),
    publishAt: isoToScheduleBoundary(menu.publishAt),
    unpublishAt: isoToScheduleBoundary(menu.unpublishAt),
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

  // A boundary with a date requires a time (and vice versa). Never silently
  // discard an incomplete value — surface an inline error instead.
  if (isBoundaryIncomplete(v.publishAt))
    errors.publishAt = "Enter both a date and a time, or clear this boundary.";
  if (isBoundaryIncomplete(v.unpublishAt))
    errors.unpublishAt = "Enter both a date and a time, or clear this boundary.";

  const pubIso = scheduleBoundaryToIso(v.publishAt);
  const unpubIso = scheduleBoundaryToIso(v.unpublishAt);
  if (pubIso && unpubIso && new Date(unpubIso) <= new Date(pubIso)) {
    errors.unpublishAt = "Hide-from date must be later than the show-from date.";
  }

  return errors;
}

/* ----------------- Legacy datetime-local helpers (still used) --------------- */

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
