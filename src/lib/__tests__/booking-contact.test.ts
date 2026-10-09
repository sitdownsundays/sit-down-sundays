/**
 * Behavioral tests for the booking wizard Step 3 (Your information) contact
 * validation.
 *
 * These exercise the REAL production validation function in
 * src/lib/booking/contact-rules.ts — not copied logic. They are helper-level
 * tests, NOT rendered component tests and NOT live server tests.
 */
import { describe, it, expect } from "vitest";
import { validateContact, CONTACT_LIMITS } from "@/lib/booking/contact-rules";
import { initialWizardState } from "@/lib/booking/wizard-helpers";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";

function stateWithContact(overrides: Partial<BookWizardState["contact"]>): BookWizardState {
  return {
    ...initialWizardState(),
    contact: { ...initialWizardState().contact, ...overrides },
  };
}

const VALID = {
  contactFirstName: "Jane",
  contactLastName: "Doe",
  contactEmail: "jane@example.com",
  contactPhone: "555-123-4567",
};

describe("validateContact — valid contact information", () => {
  it("accepts a complete valid contact", () => {
    const { errors, valid } = validateContact(stateWithContact(VALID));
    expect(valid).toBe(true);
    expect(errors).toEqual({});
  });

  it("accepts valid contact with optional notes filled", () => {
    const { valid } = validateContact(
      stateWithContact({
        ...VALID,
        dietaryNotes: "No shellfish",
        accessibilityRequests: "Wheelchair access",
        occasion: "Birthday",
        guestNotes: "Window table preferred",
      }),
    );
    expect(valid).toBe(true);
  });

  it("accepts names with apostrophes, hyphens, and accents", () => {
    const { valid } = validateContact(
      stateWithContact({
        ...VALID,
        contactFirstName: "O'Brien",
        contactLastName: "Martínez-López",
      }),
    );
    expect(valid).toBe(true);
  });
});

describe("validateContact — missing required fields", () => {
  it("rejects missing first name", () => {
    const { errors, valid } = validateContact(stateWithContact({ ...VALID, contactFirstName: "" }));
    expect(valid).toBe(false);
    expect(errors.contactFirstName).toMatch(/first name/i);
  });

  it("rejects whitespace-only first name", () => {
    const { errors, valid } = validateContact(
      stateWithContact({ ...VALID, contactFirstName: "   " }),
    );
    expect(valid).toBe(false);
    expect(errors.contactFirstName).toMatch(/first name/i);
  });

  it("rejects missing last name", () => {
    const { errors, valid } = validateContact(stateWithContact({ ...VALID, contactLastName: "" }));
    expect(valid).toBe(false);
    expect(errors.contactLastName).toMatch(/last name/i);
  });

  it("rejects missing email", () => {
    const { errors, valid } = validateContact(stateWithContact({ ...VALID, contactEmail: "" }));
    expect(valid).toBe(false);
    expect(errors.contactEmail).toMatch(/email/i);
  });

  it("rejects missing phone", () => {
    const { errors, valid } = validateContact(stateWithContact({ ...VALID, contactPhone: "" }));
    expect(valid).toBe(false);
    expect(errors.contactPhone).toMatch(/phone/i);
  });
});

describe("validateContact — invalid formats", () => {
  it("rejects an invalid email format", () => {
    const { errors, valid } = validateContact(
      stateWithContact({ ...VALID, contactEmail: "not-an-email" }),
    );
    expect(valid).toBe(false);
    expect(errors.contactEmail).toMatch(/valid email/i);
  });

  it("rejects an email missing the domain", () => {
    const { errors, valid } = validateContact(
      stateWithContact({ ...VALID, contactEmail: "jane@" }),
    );
    expect(valid).toBe(false);
    expect(errors.contactEmail).toMatch(/valid email/i);
  });

  it("rejects a phone with letters", () => {
    const { errors, valid } = validateContact(
      stateWithContact({ ...VALID, contactPhone: "555-CALL-NOW" }),
    );
    expect(valid).toBe(false);
    expect(errors.contactPhone).toMatch(/valid phone/i);
  });

  it("accepts a phone with country code and spaces", () => {
    const { valid } = validateContact(
      stateWithContact({ ...VALID, contactPhone: "+1 555 123 4567" }),
    );
    expect(valid).toBe(true);
  });

  it("rejects a name with numbers", () => {
    const { errors, valid } = validateContact(
      stateWithContact({ ...VALID, contactFirstName: "Jane123" }),
    );
    expect(valid).toBe(false);
    expect(errors.contactFirstName).toMatch(/valid first name/i);
  });
});

describe("validateContact — maximum length rules", () => {
  it("rejects a first name exceeding the max length", () => {
    const { errors, valid } = validateContact(
      stateWithContact({ ...VALID, contactFirstName: "a".repeat(CONTACT_LIMITS.firstNameMax + 1) }),
    );
    expect(valid).toBe(false);
    expect(errors.contactFirstName).toMatch(/characters or fewer/i);
  });

  it("rejects an email exceeding the max length", () => {
    const long = `${"a".repeat(CONTACT_LIMITS.emailMax)}@example.com`;
    const { errors, valid } = validateContact(stateWithContact({ ...VALID, contactEmail: long }));
    expect(valid).toBe(false);
    expect(errors.contactEmail).toMatch(/characters or fewer/i);
  });

  it("rejects dietary notes exceeding the max length", () => {
    const { errors, valid } = validateContact(
      stateWithContact({ ...VALID, dietaryNotes: "a".repeat(CONTACT_LIMITS.notesMax + 1) }),
    );
    expect(valid).toBe(false);
    expect(errors.dietaryNotes).toMatch(/characters or fewer/i);
  });

  it("rejects an occasion exceeding the max length", () => {
    const { errors, valid } = validateContact(
      stateWithContact({ ...VALID, occasion: "a".repeat(CONTACT_LIMITS.occasionMax + 1) }),
    );
    expect(valid).toBe(false);
    expect(errors.occasion).toMatch(/characters or fewer/i);
  });

  it("accepts notes at exactly the max length", () => {
    const { valid } = validateContact(
      stateWithContact({ ...VALID, dietaryNotes: "a".repeat(CONTACT_LIMITS.notesMax) }),
    );
    expect(valid).toBe(true);
  });
});

describe("validateContact — optional fields", () => {
  it("accepts empty optional notes", () => {
    const { valid } = validateContact(stateWithContact(VALID));
    expect(valid).toBe(true);
  });

  it("accepts a short occasion", () => {
    const { valid } = validateContact(stateWithContact({ ...VALID, occasion: "Anniversary" }));
    expect(valid).toBe(true);
  });
});

describe("validateContact — value preservation (purity)", () => {
  it("does not mutate the input state", () => {
    const state = stateWithContact(VALID);
    const snapshot = JSON.parse(JSON.stringify(state));
    validateContact(state);
    expect(state).toEqual(snapshot);
  });

  it("preserves entered values after a validation failure", () => {
    const state = stateWithContact({
      ...VALID,
      contactEmail: "bad-email",
      dietaryNotes: "No nuts",
    });
    const { valid } = validateContact(state);
    expect(valid).toBe(false);
    // The original values are untouched (purity).
    expect(state.contact.contactEmail).toBe("bad-email");
    expect(state.contact.dietaryNotes).toBe("No nuts");
    expect(state.contact.contactFirstName).toBe("Jane");
  });
});
