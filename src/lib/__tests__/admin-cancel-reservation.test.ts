/**
 * Cancel Reservation recovery lifecycle tests.
 *
 * These tests exercise the REAL production controller/helpers
 * (cancel-reservation-controller.ts + cancel-reservation-helpers.ts) that
 * the CancelReservationPanel component uses at runtime. They are NOT
 * rendered-component tests — the React wiring (refs, setState, callbacks) is
 * source-inspected only.
 *
 * Mocked-boundary verification: no live database, network, or Supabase calls.
 */
import { describe, expect, it } from "vitest";
import {
  blockCancelGate,
  clearCancelGate,
  createCancelGate,
  createCancelReasonMap,
  getReason,
  isCancelGateBlocked,
  setReason,
  applyCancelReloadToGate,
} from "@/components/admin/cancel-reservation-controller";
import {
  assessReloadedReservationForCancel,
  isCancellableStatus,
  requiresReloadBeforeRetry,
  reloadOutcomeMessage,
  validateCancellationReason,
} from "@/components/admin/cancel-reservation-helpers";
import type { CancelReloadResult } from "@/components/admin/cancel-reservation-helpers";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

function makeReservation(overrides: Partial<ReservationDetailDTO> = {}): ReservationDetailDTO {
  return {
    id: "res-1",
    reservationNumber: "SS-0001",
    status: "pending_review",
    paymentStatus: "unpaid",
    experienceType: "standard",
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "555-1234",
    sundayServiceId: "svc-1",
    seatingTimeId: "seat-1",
    spaceName: "Main Hall",
    serviceDate: "2026-01-04",
    seatingStartTime: "12:00",
    seatingEndTime: "14:00",
    partySize: 4,
    adults: 2,
    seniors: 1,
    children: 1,
    guestNotes: "",
    dietaryNotes: "",
    accessibilityRequests: "",
    occasion: "",
    internalNotes: "",
    subtotalCents: 11800,
    depositRequiredCents: 2950,
    grandTotalCents: 11800,
    amountPaidCents: 0,
    remainingBalanceCents: 11800,
    balanceDeadline: null,
    pricingSnapshot: {},
    policySnapshot: {},
    guests: [],
    platters: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

const reloadSuccess = (r: ReservationDetailDTO): CancelReloadResult => ({
  success: true,
  reservation: r,
});
const reloadFail = (error = "boom"): CancelReloadResult => ({
  success: false,
  reservation: null,
  error,
});

describe("cancel reservation controller — gate", () => {
  it("starts unblocked", () => {
    const gate = createCancelGate();
    expect(isCancelGateBlocked(gate, "res-1")).toBe(false);
  });

  it("blocks after an uncertain outcome and stays blocked across reads", () => {
    let gate = createCancelGate();
    gate = blockCancelGate(gate, "res-1");
    expect(isCancelGateBlocked(gate, "res-1")).toBe(true);
    // A second read still blocked (survives close/reopen since gate is parent-owned).
    expect(isCancelGateBlocked(gate, "res-1")).toBe(true);
  });

  it("clears the gate for that reservation only", () => {
    let gate = createCancelGate();
    gate = blockCancelGate(gate, "res-1");
    gate = blockCancelGate(gate, "res-2");
    gate = clearCancelGate(gate, "res-1");
    expect(isCancelGateBlocked(gate, "res-1")).toBe(false);
    expect(isCancelGateBlocked(gate, "res-2")).toBe(true);
  });
});

describe("cancel reservation controller — reason survives close/reopen", () => {
  it("stores and reads a reason keyed by reservation", () => {
    let map = createCancelReasonMap();
    map = setReason(map, "res-1", "No longer needed");
    expect(getReason(map, "res-1")).toBe("No longer needed");
  });

  it("returns empty for an unknown reservation", () => {
    const map = createCancelReasonMap();
    expect(getReason(map, "res-1")).toBe("");
  });

  it("reason persists across reads (simulating close/reopen)", () => {
    let map = createCancelReasonMap();
    map = setReason(map, "res-1", "Party size changed");
    // "Close" = stop rendering dialog; "reopen" = read again. State is unchanged.
    expect(getReason(map, "res-1")).toBe("Party size changed");
  });
});

describe("applyCancelReloadToGate", () => {
  it("failed reload leaves the gate blocked and assessment null", () => {
    let gate = blockCancelGate(createCancelGate(), "res-1");
    const { gate: g2, assessment } = applyCancelReloadToGate(gate, reloadFail());
    gate = g2;
    expect(isCancelGateBlocked(gate, "res-1")).toBe(true);
    expect(assessment).toBeNull();
  });

  it("cancellable reload clears the gate", () => {
    let gate = blockCancelGate(createCancelGate(), "res-1");
    const fresh = makeReservation({ updatedAt: "2026-01-01T11:00:00Z" });
    const { gate: g2, assessment } = applyCancelReloadToGate(gate, reloadSuccess(fresh));
    gate = g2;
    expect(isCancelGateBlocked(gate, "res-1")).toBe(false);
    expect(assessment?.kind).toBe("cancellable");
  });

  it("already_cancelled reload keeps the gate blocked", () => {
    let gate = blockCancelGate(createCancelGate(), "res-1");
    const fresh = makeReservation({ status: "cancelled" });
    const { gate: g2, assessment } = applyCancelReloadToGate(gate, reloadSuccess(fresh));
    gate = g2;
    expect(isCancelGateBlocked(gate, "res-1")).toBe(true);
    expect(assessment?.kind).toBe("already_cancelled");
  });

  it("non_cancellable reload keeps the gate blocked", () => {
    let gate = blockCancelGate(createCancelGate(), "res-1");
    const fresh = makeReservation({ status: "completed" });
    const { gate: g2, assessment } = applyCancelReloadToGate(gate, reloadSuccess(fresh));
    gate = g2;
    expect(isCancelGateBlocked(gate, "res-1")).toBe(true);
    expect(assessment?.kind).toBe("non_cancellable");
  });
});

describe("assessReloadedReservationForCancel", () => {
  it("marks pending_review as cancellable", () => {
    const a = assessReloadedReservationForCancel(makeReservation({ status: "pending_review" }));
    expect(a.kind).toBe("cancellable");
  });

  it("marks confirmed as cancellable", () => {
    const a = assessReloadedReservationForCancel(makeReservation({ status: "confirmed" }));
    expect(a.kind).toBe("cancellable");
  });

  it("marks cancelled as already_cancelled", () => {
    const a = assessReloadedReservationForCancel(makeReservation({ status: "cancelled" }));
    expect(a.kind).toBe("already_cancelled");
  });

  it("marks checked_in as non_cancellable", () => {
    const a = assessReloadedReservationForCancel(makeReservation({ status: "checked_in" }));
    expect(a.kind).toBe("non_cancellable");
    if (a.kind === "non_cancellable") expect(a.status).toBe("checked_in");
  });
});

describe("reload identity + timestamp", () => {
  it("successful adoption uses the exact fresh timestamp", () => {
    const fresh = makeReservation({ updatedAt: "2026-01-02T09:30:45.123Z" });
    const { assessment } = applyCancelReloadToGate(createCancelGate(), reloadSuccess(fresh));
    expect(assessment?.reservation.updatedAt).toBe("2026-01-02T09:30:45.123Z");
  });

  it("wrong-reservation reload cannot unlock cancellation (panel identity check)", () => {
    // The panel checks res.reservation.id !== requestedId BEFORE calling
    // applyCancelReloadToGate; a mismatched ID returns a failed result. Here
    // we verify the contract: a failed result never clears the gate.
    let gate = blockCancelGate(createCancelGate(), "res-1");
    const wrongIdReload = reloadFail("Could not reload the reservation.");
    const { gate: g2 } = applyCancelReloadToGate(gate, wrongIdReload);
    gate = g2;
    expect(isCancelGateBlocked(gate, "res-1")).toBe(true);
  });
});

describe("requiresReloadBeforeRetry", () => {
  it("requires reload for conflict, unexpected, and invalid_status", () => {
    expect(requiresReloadBeforeRetry("conflict")).toBe(true);
    expect(requiresReloadBeforeRetry("unexpected")).toBe(true);
    expect(requiresReloadBeforeRetry("invalid_status")).toBe(true);
  });
  it("does not require reload for not_found or invalid_data", () => {
    expect(requiresReloadBeforeRetry("not_found")).toBe(false);
    expect(requiresReloadBeforeRetry("invalid_data")).toBe(false);
  });
});

describe("reloadOutcomeMessage", () => {
  it("returns null for cancellable (pending_review)", () => {
    expect(reloadOutcomeMessage("pending_review")).toBeNull();
  });
  it("returns already-cancelled message for cancelled", () => {
    expect(reloadOutcomeMessage("cancelled")).toContain("already cancelled");
  });
  it("returns unavailable message for non-cancellable", () => {
    const msg = reloadOutcomeMessage("completed");
    expect(msg).toContain("completed");
    expect(msg).toContain("not available");
  });
});

describe("validateCancellationReason (unchanged safeguards)", () => {
  it("rejects empty", () => {
    expect(validateCancellationReason("")).toContain("required");
  });
  it("rejects whitespace-only", () => {
    expect(validateCancellationReason("   \n\t ")).toContain("whitespace");
  });
  it("accepts valid reason", () => {
    expect(validateCancellationReason("Guest requested cancellation")).toBeNull();
  });
  it("rejects over-length", () => {
    expect(validateCancellationReason("x".repeat(1001))).toContain("1000");
  });
});

describe("isCancellableStatus (unchanged allow-list)", () => {
  it("allows pending_review and confirmed", () => {
    expect(isCancellableStatus("pending_review")).toBe(true);
    expect(isCancellableStatus("confirmed")).toBe(true);
  });
  it("rejects checked_in and completed", () => {
    expect(isCancellableStatus("checked_in")).toBe(false);
    expect(isCancellableStatus("completed")).toBe(false);
  });
});
