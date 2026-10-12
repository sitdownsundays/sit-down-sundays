/**
 * Admin approval reservation — focused helper/controller tests.
 *
 * The project's vitest config runs in the `node` environment (no DOM), so
 * rendered React component tests are not supported. These tests exercise the
 * REAL production helpers (approval-reservation-helpers.ts) and controller
 * (approval-reservation-controller.ts) that the dialog and admin-reservations
 * page consume.
 *
 * Dialog wiring (onApproveForPayment prop, gate management, onSaved/onReload
 * callbacks) is source-inspected, not rendered-verified.
 */
import { describe, it, expect } from "vitest";

import type { ReservationDetailDTO } from "@/lib/reservation/types";
import {
  isApprovalEligible,
  isAlreadyApproved,
  buildApprovalPayload,
  requiresReloadBeforeRetry,
  partyDisplayName,
  assessReloadedReservation,
  assessReloadResponse,
  successMessage,
  reloadOutcomeMessage,
  APPROVAL_SUCCESS_MSG,
  ALREADY_APPROVED_MSG,
  type ApprovalFormState,
} from "@/components/admin/approval-reservation-helpers";
import {
  createApprovalGate,
  isGateBlocked,
  blockGate,
  clearGate,
  applyReloadToGate,
} from "@/components/admin/approval-reservation-controller";

/* ---- Fixtures ---- */

function makeDetail(overrides: Partial<ReservationDetailDTO> = {}): ReservationDetailDTO {
  return {
    id: "r-1",
    reservationNumber: "SDS-20261025-AB12",
    status: "pending_review",
    paymentStatus: "unpaid",
    experienceType: "standard",
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "555-1234",
    sundayServiceId: "svc-1",
    seatingTimeId: "seat-1",
    spaceName: "Grand Ballroom",
    serviceDate: "2026-10-25",
    seatingStartTime: "12:00",
    seatingEndTime: "14:30",
    partySize: 4,
    adults: 3,
    seniors: 1,
    children: 0,
    guestNotes: "",
    dietaryNotes: "",
    accessibilityRequests: "",
    occasion: "",
    internalNotes: "",
    subtotalCents: 10000,
    depositRequiredCents: 5000,
    grandTotalCents: 10000,
    amountPaidCents: 0,
    remainingBalanceCents: 5000,
    balanceDeadline: "2026-10-22T12:00:00Z",
    approval: {
      requiresManagementApproval: true,
      approvedAt: null,
      approvedBy: null,
      timingBasis: "late_booking_under_168h",
      submittedAt: "2026-10-20T10:00:00Z",
      seatingStart: "2026-10-25T12:00:00Z",
      restaurantTimezone: "America/Chicago",
    },
    pricingSnapshot: {},
    policySnapshot: {},
    guests: [],
    platters: [],
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    ...overrides,
  };
}

const lateUnapproved = makeDetail();
const earlyUnapproved = makeDetail({
  approval: {
    requiresManagementApproval: false,
    approvedAt: null,
    approvedBy: null,
    timingBasis: "early_booking_168h_or_more",
    submittedAt: "2026-10-01T10:00:00Z",
    seatingStart: "2026-10-25T12:00:00Z",
    restaurantTimezone: "America/Chicago",
  },
});
const approved = makeDetail({
  approval: {
    requiresManagementApproval: true,
    approvedAt: "2026-10-20T11:00:00Z",
    approvedBy: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    timingBasis: "late_booking_under_168h",
    submittedAt: "2026-10-20T10:00:00Z",
    seatingStart: "2026-10-25T12:00:00Z",
    restaurantTimezone: "America/Chicago",
  },
});
const historical = makeDetail({
  approval: {
    requiresManagementApproval: false,
    approvedAt: null,
    approvedBy: null,
    timingBasis: "historical_unverified",
    submittedAt: null,
    seatingStart: null,
    restaurantTimezone: null,
  },
});

/* ---- isApprovalEligible ---- */

describe("isApprovalEligible", () => {
  it("eligible late unapproved request", () => {
    expect(isApprovalEligible(lateUnapproved)).toBe(true);
  });

  it("early booking does not require approval", () => {
    expect(isApprovalEligible(earlyUnapproved)).toBe(false);
  });

  it("already approved is not eligible for a new approval", () => {
    expect(isApprovalEligible(approved)).toBe(false);
  });

  it("cancelled status is not eligible", () => {
    expect(isApprovalEligible(makeDetail({ status: "cancelled" }))).toBe(false);
  });

  it("completed status is not eligible", () => {
    expect(isApprovalEligible(makeDetail({ status: "completed" }))).toBe(false);
  });

  it("payment already made is not eligible", () => {
    expect(
      isApprovalEligible(makeDetail({ amountPaidCents: 5000, paymentStatus: "deposit_paid" })),
    ).toBe(false);
  });

  it("zero deposit is not eligible", () => {
    expect(isApprovalEligible(makeDetail({ depositRequiredCents: 0 }))).toBe(false);
  });

  it("deposit exceeding grand total is not eligible", () => {
    expect(
      isApprovalEligible(makeDetail({ depositRequiredCents: 20000, grandTotalCents: 10000 })),
    ).toBe(false);
  });

  it("missing approval object is not eligible", () => {
    const noApproval = makeDetail();
    (noApproval as { approval?: unknown }).approval = undefined;
    expect(isApprovalEligible(noApproval)).toBe(false);
  });

  it("historical unverified is not eligible (no management approval required)", () => {
    expect(isApprovalEligible(historical)).toBe(false);
  });
});

/* ---- isAlreadyApproved ---- */

describe("isAlreadyApproved", () => {
  it("approved reservation is already approved", () => {
    expect(isAlreadyApproved(approved)).toBe(true);
  });

  it("unapproved is not already approved", () => {
    expect(isAlreadyApproved(lateUnapproved)).toBe(false);
  });

  it("partial approval (only approvedAt) is not already approved", () => {
    const partial = makeDetail({
      approval: {
        requiresManagementApproval: true,
        approvedAt: "2026-10-20T11:00:00Z",
        approvedBy: null,
        timingBasis: "late_booking_under_168h",
        submittedAt: "2026-10-20T10:00:00Z",
        seatingStart: "2026-10-25T12:00:00Z",
        restaurantTimezone: "America/Chicago",
      },
    });
    expect(isAlreadyApproved(partial)).toBe(false);
  });
});

/* ---- buildApprovalPayload ---- */

describe("buildApprovalPayload", () => {
  const baseForm: ApprovalFormState = {
    balanceDeadlineType: "default",
    customHours: "",
    customDeadline: "",
    reason: "",
  };

  it("default mode omits optional fields", () => {
    const payload = buildApprovalPayload(lateUnapproved, baseForm);
    expect(payload).toEqual({
      reservationId: "r-1",
      expectedUpdatedAt: "2026-10-20T10:00:00Z",
      balanceDeadlineType: "default",
    });
    expect(payload).not.toHaveProperty("customHours");
    expect(payload).not.toHaveProperty("customDeadline");
    expect(payload).not.toHaveProperty("reason");
  });

  it("hours_before includes customHours and reason", () => {
    const payload = buildApprovalPayload(lateUnapproved, {
      ...baseForm,
      balanceDeadlineType: "hours_before",
      customHours: "48",
      reason: "Guest requested shorter deadline",
    });
    expect(payload.balanceDeadlineType).toBe("hours_before");
    expect(payload.customHours).toBe(48);
    expect(payload.reason).toBe("Guest requested shorter deadline");
    expect(payload).not.toHaveProperty("customDeadline");
  });

  it("custom includes customDeadline and reason", () => {
    const payload = buildApprovalPayload(lateUnapproved, {
      ...baseForm,
      balanceDeadlineType: "custom",
      customDeadline: "2026-10-23T18:00:00-05:00",
      reason: "Specific pickup time",
    });
    expect(payload.balanceDeadlineType).toBe("custom");
    expect(payload.customDeadline).toBe("2026-10-23T18:00:00-05:00");
    expect(payload.reason).toBe("Specific pickup time");
    expect(payload).not.toHaveProperty("customHours");
  });

  it("at_check_in includes reason only", () => {
    const payload = buildApprovalPayload(lateUnapproved, {
      ...baseForm,
      balanceDeadlineType: "at_check_in",
      reason: "Pay at door",
    });
    expect(payload.balanceDeadlineType).toBe("at_check_in");
    expect(payload.reason).toBe("Pay at door");
    expect(payload).not.toHaveProperty("customHours");
    expect(payload).not.toHaveProperty("customDeadline");
  });

  it("preserves original updatedAt verbatim", () => {
    const r = makeDetail({ updatedAt: "2026-10-20T10:00:00.123Z" });
    const payload = buildApprovalPayload(r, baseForm);
    expect(payload.expectedUpdatedAt).toBe("2026-10-20T10:00:00.123Z");
  });

  it("preserves reservation ID verbatim", () => {
    const r = makeDetail({ id: "abc-123-def" });
    const payload = buildApprovalPayload(r, baseForm);
    expect(payload.reservationId).toBe("abc-123-def");
  });

  it("truncates fractional customHours to integer", () => {
    const payload = buildApprovalPayload(lateUnapproved, {
      ...baseForm,
      balanceDeadlineType: "hours_before",
      customHours: "48.9",
      reason: "test",
    });
    expect(payload.customHours).toBe(48);
  });

  it("rejects non-finite customHours", () => {
    const payload = buildApprovalPayload(lateUnapproved, {
      ...baseForm,
      balanceDeadlineType: "hours_before",
      customHours: "NaN",
      reason: "test",
    });
    expect(payload).not.toHaveProperty("customHours");
  });

  it("rejects zero or negative customHours", () => {
    const p1 = buildApprovalPayload(lateUnapproved, {
      ...baseForm,
      balanceDeadlineType: "hours_before",
      customHours: "0",
      reason: "test",
    });
    expect(p1).not.toHaveProperty("customHours");

    const p2 = buildApprovalPayload(lateUnapproved, {
      ...baseForm,
      balanceDeadlineType: "hours_before",
      customHours: "-5",
      reason: "test",
    });
    expect(p2).not.toHaveProperty("customHours");
  });

  it("trims reason whitespace", () => {
    const payload = buildApprovalPayload(lateUnapproved, {
      ...baseForm,
      balanceDeadlineType: "at_check_in",
      reason: "  spaced reason  ",
    });
    expect(payload.reason).toBe("spaced reason");
  });
});

/* ---- requiresReloadBeforeRetry ---- */

describe("requiresReloadBeforeRetry", () => {
  it("conflict requires reload", () => {
    expect(requiresReloadBeforeRetry("conflict")).toBe(true);
  });

  it("checkout_requires_review requires reload", () => {
    expect(requiresReloadBeforeRetry("checkout_requires_review")).toBe(true);
  });

  it("invalid_status requires reload", () => {
    expect(requiresReloadBeforeRetry("invalid_status")).toBe(true);
  });

  it("invalid_capacity requires reload", () => {
    expect(requiresReloadBeforeRetry("invalid_capacity")).toBe(true);
  });

  it("not_found requires reload", () => {
    expect(requiresReloadBeforeRetry("not_found")).toBe(true);
  });

  it("default_deadline_passed does NOT require reload (keep dialog open)", () => {
    expect(requiresReloadBeforeRetry("default_deadline_passed")).toBe(false);
  });

  it("invalid_deadline does NOT require reload (keep dialog open)", () => {
    expect(requiresReloadBeforeRetry("invalid_deadline")).toBe(false);
  });

  it("unexpected requires reload", () => {
    expect(requiresReloadBeforeRetry("unexpected")).toBe(true);
  });
});

/* ---- partyDisplayName ---- */

describe("partyDisplayName", () => {
  it("first and last name", () => {
    expect(partyDisplayName(makeDetail({ contactFirstName: "Jane", contactLastName: "Doe" }))).toBe(
      "Jane Doe",
    );
  });

  it("first name only", () => {
    expect(partyDisplayName(makeDetail({ contactFirstName: "Jane", contactLastName: "" }))).toBe(
      "Jane",
    );
  });

  it("last name only", () => {
    expect(partyDisplayName(makeDetail({ contactFirstName: "", contactLastName: "Doe" }))).toBe(
      "Doe",
    );
  });

  it("falls back to reservation number", () => {
    expect(
      partyDisplayName(
        makeDetail({ contactFirstName: "  ", contactLastName: "  ", reservationNumber: "SDS-1" }),
      ),
    ).toBe("SDS-1");
  });
});

/* ---- assessReloadedReservation ---- */

describe("assessReloadedReservation", () => {
  it("approvable", () => {
    const a = assessReloadedReservation(lateUnapproved);
    expect(a.kind).toBe("approvable");
    expect(a.reservation.id).toBe("r-1");
  });

  it("already approved", () => {
    const a = assessReloadedReservation(approved);
    expect(a.kind).toBe("already_approved");
  });

  it("inapplicable for cancelled", () => {
    const a = assessReloadedReservation(makeDetail({ status: "cancelled" }));
    expect(a.kind).toBe("inapplicable");
    expect(a.status).toBe("cancelled");
  });

  it("inapplicable for early booking (no approval needed)", () => {
    const a = assessReloadedReservation(earlyUnapproved);
    expect(a.kind).toBe("inapplicable");
  });
});

/* ---- successMessage ---- */

describe("successMessage", () => {
  it("fresh approval", () => {
    expect(successMessage(false)).toBe(APPROVAL_SUCCESS_MSG);
  });

  it("already approved recovery", () => {
    expect(successMessage(true)).toBe(ALREADY_APPROVED_MSG);
  });
});

/* ---- reloadOutcomeMessage ---- */

describe("reloadOutcomeMessage", () => {
  it("approvable returns null", () => {
    expect(reloadOutcomeMessage(lateUnapproved)).toBeNull();
  });

  it("already approved returns the approved message", () => {
    expect(reloadOutcomeMessage(approved)).toBe(ALREADY_APPROVED_MSG);
  });

  it("inapplicable returns a status-specific message", () => {
    const msg = reloadOutcomeMessage(makeDetail({ status: "cancelled" }));
    expect(msg).toContain("cancelled");
    expect(msg).toContain("Approval is not available");
  });

  it("does not claim payment was received for already approved", () => {
    const msg = reloadOutcomeMessage(approved);
    expect(msg).not.toContain("paid");
    expect(msg).not.toContain("confirmed");
  });
});

/* ---- Controller: gate lifecycle ---- */

describe("approval gate controller", () => {
  it("fresh gate is empty and not blocked", () => {
    const gate = createApprovalGate();
    expect(isGateBlocked(gate, "r-1")).toBe(false);
  });

  it("blockGate blocks and clearGate clears", () => {
    let gate = createApprovalGate();
    gate = blockGate(gate, "r-1");
    expect(isGateBlocked(gate, "r-1")).toBe(true);
    gate = clearGate(gate, "r-1");
    expect(isGateBlocked(gate, "r-1")).toBe(false);
  });

  it("clearGate on unblocked gate is a no-op", () => {
    const gate = createApprovalGate();
    expect(clearGate(gate, "r-1")).toBe(gate);
  });

  it("blockGate does not mutate the original gate", () => {
    const gate = createApprovalGate();
    const blocked = blockGate(gate, "r-1");
    expect(isGateBlocked(gate, "r-1")).toBe(false);
    expect(isGateBlocked(blocked, "r-1")).toBe(true);
  });

  it("multiple reservations are independent", () => {
    let gate = createApprovalGate();
    gate = blockGate(gate, "r-1");
    gate = blockGate(gate, "r-2");
    expect(isGateBlocked(gate, "r-1")).toBe(true);
    expect(isGateBlocked(gate, "r-2")).toBe(true);
    gate = clearGate(gate, "r-1");
    expect(isGateBlocked(gate, "r-1")).toBe(false);
    expect(isGateBlocked(gate, "r-2")).toBe(true);
  });
});

/* ---- Controller: applyReloadToGate ---- */

describe("applyReloadToGate", () => {
  it("failed reload keeps gate blocked", () => {
    const gate = blockGate(createApprovalGate(), "r-1");
    const result = applyReloadToGate(gate, {
      success: false,
      reservation: null,
      error: "fail",
    });
    expect(isGateBlocked(result.gate, "r-1")).toBe(true);
    expect(result.assessment).toBeNull();
  });

  it("approvable reload clears the gate", () => {
    const gate = blockGate(createApprovalGate(), "r-1");
    const result = applyReloadToGate(gate, {
      success: true,
      reservation: lateUnapproved,
    });
    expect(isGateBlocked(result.gate, "r-1")).toBe(false);
    expect(result.assessment?.kind).toBe("approvable");
  });

  it("already-approved reload keeps gate blocked", () => {
    const gate = blockGate(createApprovalGate(), "r-1");
    const result = applyReloadToGate(gate, {
      success: true,
      reservation: approved,
    });
    expect(isGateBlocked(result.gate, "r-1")).toBe(true);
    expect(result.assessment?.kind).toBe("already_approved");
  });

  it("inapplicable reload keeps gate blocked", () => {
    const gate = blockGate(createApprovalGate(), "r-1");
    const result = applyReloadToGate(gate, {
      success: true,
      reservation: makeDetail({ status: "cancelled" }),
    });
    expect(isGateBlocked(result.gate, "r-1")).toBe(true);
    expect(result.assessment?.kind).toBe("inapplicable");
  });
});

/* ---- assessReloadResponse (endpoint { ok, reservation? } → ApprovalReloadResult) ---- */

describe("assessReloadResponse", () => {
  it("ok:true with reservation returns success and adopts the returned reservation", () => {
    const result = assessReloadResponse({ ok: true, reservation: lateUnapproved });
    expect(result.success).toBe(true);
    expect(result.reservation).toBe(lateUnapproved);
    expect(result.reservation?.id).toBe("r-1");
  });

  it("ok:false with error returns failure and does not adopt a reservation", () => {
    const result = assessReloadResponse({ ok: false, error: "Could not load." });
    expect(result.success).toBe(false);
    expect(result.reservation).toBeNull();
    expect(result.error).toBe("Could not load.");
  });

  it("ok:false without error message uses a safe default", () => {
    const result = assessReloadResponse({ ok: false });
    expect(result.success).toBe(false);
    expect(result.reservation).toBeNull();
    expect(result.error).toBe("Could not reload the reservation.");
  });

  it("ok:true but missing reservation returns failure (no state adoption)", () => {
    const result = assessReloadResponse({ ok: true, reservation: undefined } as unknown as {
      ok: true;
      reservation?: ReservationDetailDTO;
    });
    expect(result.success).toBe(false);
    expect(result.reservation).toBeNull();
  });

  it("does not claim success for a stale/mismatched response", () => {
    // ok:false must never be interpreted as success — the caller's generation
    // guard handles stale ordering; this helper must not silently resurrect it.
    const result = assessReloadResponse({ ok: false, error: "stale" });
    expect(result.success).toBe(false);
    expect(result.reservation).toBeNull();
    expect(result.error).not.toBe("");
  });
});
