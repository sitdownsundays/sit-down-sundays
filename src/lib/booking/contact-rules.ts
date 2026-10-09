/**
 * Booking wizard contact validation — client-safe, framework-independent.
 *
 * Mirrors the authoritative server-side field rules in
 * src/lib/reservation/schema.ts (submitReservationRequestSchema) so the
 * browser and server agree. The server re-validates authoritatively; these
 * rules are for client-side UX guidance only.
 *
 * No server-only imports, no env access, no Supabase.
 */
import type { BookWizardState } from "@/lib/booking/wizard-helpers";

/** Mirrors the server NAME_RE. */
const NAME_RE = /^[\p{L}\p{M}'’.\- ]{1,120}$/u;
/** Mirrors the server PHONE_RE. */
const PHONE_RE = /^[+]?[\d\s().-]{7,40}$/;

export const CONTACT_LIMITS = {
  firstNameMax: 120,
  lastNameMax: 120,
  emailMax: 320,
  phoneMax: 40,
  notesMax: 2000,
  occasionMax: 160,
} as const;

export interface ContactFieldErrors {
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactPhone?: string;
  dietaryNotes?: string;
  accessibilityRequests?: string;
  occasion?: string;
  guestNotes?: string;
}

export interface ContactValidation {
  errors: ContactFieldErrors;
  /** True when there are no field errors. */
  valid: boolean;
}

/**
 * Validate the contact fields stored in the wizard state against the shared
 * rules. Returns a map of field errors (only populated fields) and a valid
 * flag. Optional fields are validated only when non-empty.
 *
 * Pure; does not mutate input.
 */
export function validateContact(state: BookWizardState): ContactValidation {
  const errors: ContactFieldErrors = {};
  const c = state.contact;

  // First name — required.
  const first = c.contactFirstName.trim();
  if (first.length === 0) {
    errors.contactFirstName = "First name is required";
  } else if (first.length > CONTACT_LIMITS.firstNameMax) {
    errors.contactFirstName = `First name must be ${CONTACT_LIMITS.firstNameMax} characters or fewer`;
  } else if (!NAME_RE.test(first)) {
    errors.contactFirstName = "Enter a valid first name";
  }

  // Last name — required.
  const last = c.contactLastName.trim();
  if (last.length === 0) {
    errors.contactLastName = "Last name is required";
  } else if (last.length > CONTACT_LIMITS.lastNameMax) {
    errors.contactLastName = `Last name must be ${CONTACT_LIMITS.lastNameMax} characters or fewer`;
  } else if (!NAME_RE.test(last)) {
    errors.contactLastName = "Enter a valid last name";
  }

  // Email — required.
  const email = c.contactEmail.trim();
  if (email.length === 0) {
    errors.contactEmail = "Email is required";
  } else if (email.length > CONTACT_LIMITS.emailMax) {
    errors.contactEmail = `Email must be ${CONTACT_LIMITS.emailMax} characters or fewer`;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.contactEmail = "Enter a valid email";
  }

  // Phone — required.
  const phone = c.contactPhone.trim();
  if (phone.length === 0) {
    errors.contactPhone = "Phone is required";
  } else if (phone.length > CONTACT_LIMITS.phoneMax) {
    errors.contactPhone = `Phone must be ${CONTACT_LIMITS.phoneMax} characters or fewer`;
  } else if (!PHONE_RE.test(phone)) {
    errors.contactPhone = "Enter a valid phone number";
  }

  // Optional notes — length only.
  if (c.dietaryNotes.length > CONTACT_LIMITS.notesMax) {
    errors.dietaryNotes = `Dietary notes must be ${CONTACT_LIMITS.notesMax} characters or fewer`;
  }
  if (c.accessibilityRequests.length > CONTACT_LIMITS.notesMax) {
    errors.accessibilityRequests = `Accessibility requests must be ${CONTACT_LIMITS.notesMax} characters or fewer`;
  }
  if (c.occasion.length > CONTACT_LIMITS.occasionMax) {
    errors.occasion = `Occasion must be ${CONTACT_LIMITS.occasionMax} characters or fewer`;
  }
  if (c.guestNotes.length > CONTACT_LIMITS.notesMax) {
    errors.guestNotes = `Requests must be ${CONTACT_LIMITS.notesMax} characters or fewer`;
  }

  return { errors, valid: Object.keys(errors).length === 0 };
}

/** Whether a contact field has an error (for aria-invalid wiring). */
export function hasContactError(
  errors: ContactFieldErrors,
  field: keyof ContactFieldErrors,
): boolean {
  return Boolean(errors[field]);
}
