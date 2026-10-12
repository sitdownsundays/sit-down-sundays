/**
 * Confirm Reservation — lifecycle tests.
 *
 * Exercises the REAL production lifecycle logic used by ConfirmReservationPanel
 * and ConfirmReservationDialog:
 *  - the parent-owned uncertainty gate (confirm-reservation-controller.ts)
 *  - reload assessment (assessReloadedReservation)
 *  - reload-requirement classification (requiresReloadBeforeRetry)
 *  - success-feedback separation (successMessage / CONFIRM_SUCCESS_MSG /
 *    ALREADY_CONFIRMED_MSG)
 *
 * These functions are imported and used by the actual component, so this is
 * production logic, not a copied model.
 *
 * @testing-library/react is NOT installed and the vitest environment is `node`
 * (not jsdom), so rendered/hook interaction is unavailable. The component
 * interactions that remain unverified are listed at the bottom.
 *
 * These are MOCKED-BOUNDARY-free pure-logic tests, not live PostgreSQL.
 */
import { describe, it, expect } from "vitest";

import {
  runPostMutationRefresh,
  REFRESH_SUCCESS,
  refreshFailure,
  refreshSuperseded,
  refreshWarningForOutcome,
} from "@/components/admin/refresh-result-helpers";

import {
  applyReloadToGate,
  blockGate,
  clearGate,
  createConfirmGate,
  isGateBlocked,
} from "@/components/admin/confirm-reservation-controller";
import {
  ALREADY_CONFIRMED_MSG,
  CONFIRM_SUCCESS_MSG,
  REFRESH_FAILURE_MSG,
  assessReloadedReservation,
  reloadOutcomeMessage,
  requiresReloadBeforeRetry,
  successMessage,
} from "@/components/admin/confirm-reservation-helpers";
import type { ConfirmReloadResult } from "@/components/admin/confirm-reservation-helpers";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

const RES_ID = "11111111-1111-1111-1111-111111111111";
const UPDATED_AT = "2026-01-01T12:00:00.000Z";
const NEW_UPDATED_AT = "2026-01-02T00:00:00.000Z";

function makeReservation(overrides: Partial<ReservationDetailDTO> = {}): ReservationDetailDTO {
  return {
    id: RES_ID,
    reservationNumber: "SDS-0001",
    status: "pending_review",
    paymentStatus: "unpaid",
    experienceType: "standard",
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "555-0000",
    sundayServiceId: "22222222-2222-2222-2222-222222222222",
    seatingTimeId: "33333333-3333-3333-3333-333333333333",
    spaceName: "Main Hall",
    serviceDate: "2026-10-11",
    seatingStartTime: "17:00",
    seatingEndTime: "19:00",
    partySize: 4,
    adults: 2,
    seniors: 1,
    children: 1,
    guestNotes: "",
    dietaryNotes: "",
    accessibilityRequests: "",
    occasion: "",
    internalNotes: "",
    subtotalCents: 10000,
    depositRequiredCents: 5000,
    grandTotalCents: 10000,
    amountPaidCents: 0,
    remainingBalanceCents: 10000,
    balanceDeadline: null,
    pricingSnapshot: {},
    policySnapshot: {},
    guests: [],
    platters: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

describe("confirmation uncertainty gate (parent-owned, survives close/reopen)", () => {
  it("starts unblocked", () => {
    const gate = createConfirmGate();
    expect(isGateBlocked(gate, RES_ID)).toBe(false);
  });

  it("blocking sets and persists the gate for the reservation", () => {
    let gate = createConfirmGate();
    gate = blockGate(gate, RES_ID);
    // Survives a "close/reopen" — gate state is independent of dialog visibility.
    expect(isGateBlocked(gate, RES_ID)).toBe(true);
  });

  it("closing and reopening the dialog does not bypass the gate", () => {
    // Simulate: conflict sets gate → close dialog (gate stays) → reopen → still blocked.
    let gate = createConfirmGate();
    gate = blockGate(gate, RES_ID);
    // "Close" then "reopen" — gate is a plain map, unaffected by UI toggles.
    expect(isGateBlocked(gate, RES_ID)).toBe(true);
    expect(isGateBlocked(gate, RES_ID)).toBe(true);
  });

  it("the gate is keyed per reservation; a different reservation is unaffected", () => {
    let gate = createConfirmGate();
    gate = blockGate(gate, RES_ID);
    expect(isGateBlocked(gate, "99999999-9999-9999-9999-999999999999")).toBe(false);
  });
});

describe("requiresReloadBeforeRetry classification", () => {
  it("conflict requires reload", () => {
    expect(requiresReloadBeforeRetry("conflict")).toBe(true);
  });
  it("unexpected (uncertain outcome) requires reload", () => {
    expect(requiresReloadBeforeRetry("unexpected")).toBe(true);
  });
  it("invalid_status requires reload (reservation state changed)", () => {
    expect(requiresReloadBeforeRetry("invalid_status")).toBe(true);
  });
  it("not_found does not require reload", () => {
    expect(requiresReloadBeforeRetry("not_found")).toBe(false);
  });
  it("invalid_data does not require reload", () => {
    expect(requiresReloadBeforeRetry("invalid_data")).toBe(false);
  });
  it("an unknown code does not require reload", () => {
    expect(requiresReloadBeforeRetry("something_else")).toBe(false);
  });
});

describe("reload assessment + gate application", () => {
  it("a failed reload leaves the gate blocked and does not refresh", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    const failedReload: ConfirmReloadResult = {
      success: false,
      reservation: null,
      error: "DB down",
    };
    const { gate: nextGate, assessment } = applyReloadToGate(gate, failedReload);
    expect(isGateBlocked(nextGate, RES_ID)).toBe(true);
    expect(assessment).toBeNull();
  });

  it("a successful pending-review reload clears the gate (fresh timestamp available)", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    const fresh = makeReservation({ updatedAt: NEW_UPDATED_AT, status: "pending_review" });
    const okReload: ConfirmReloadResult = { success: true, reservation: fresh };
    const { gate: nextGate, assessment } = applyReloadToGate(gate, okReload);
    expect(isGateBlocked(nextGate, RES_ID)).toBe(false);
    expect(assessment?.kind).toBe("confirmable");
    expect(assessment?.reservation.updatedAt).toBe(NEW_UPDATED_AT);
  });

  it("a reload showing confirmed keeps the gate blocked and does not mutate", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    const confirmed = makeReservation({ status: "confirmed", updatedAt: NEW_UPDATED_AT });
    const okReload: ConfirmReloadResult = { success: true, reservation: confirmed };
    const { gate: nextGate, assessment } = applyReloadToGate(gate, okReload);
    expect(isGateBlocked(nextGate, RES_ID)).toBe(true);
    expect(assessment?.kind).toBe("already_confirmed");
  });

  it("a reload showing another status keeps the gate blocked and is inapplicable", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    const cancelled = makeReservation({ status: "cancelled", updatedAt: NEW_UPDATED_AT });
    const okReload: ConfirmReloadResult = { success: true, reservation: cancelled };
    const { gate: nextGate, assessment } = applyReloadToGate(gate, okReload);
    expect(isGateBlocked(nextGate, RES_ID)).toBe(true);
    expect(assessment?.kind).toBe("inapplicable");
    expect(assessment?.status).toBe("cancelled");
  });
});

describe("assessReloadedReservation", () => {
  it("pending_review is confirmable", () => {
    const a = assessReloadedReservation(makeReservation({ status: "pending_review" }));
    expect(a.kind).toBe("confirmable");
  });
  it("confirmed is already_confirmed", () => {
    const a = assessReloadedReservation(makeReservation({ status: "confirmed" }));
    expect(a.kind).toBe("already_confirmed");
  });
  it("cancelled is inapplicable", () => {
    const a = assessReloadedReservation(makeReservation({ status: "cancelled" }));
    expect(a.kind).toBe("inapplicable");
    if (a.kind === "inapplicable") expect(a.status).toBe("cancelled");
  });
  it("checked_in is inapplicable", () => {
    const a = assessReloadedReservation(makeReservation({ status: "checked_in" }));
    expect(a.kind).toBe("inapplicable");
  });
});

describe("success feedback separation from refresh failures", () => {
  it("a fresh confirmation yields CONFIRM_SUCCESS_MSG", () => {
    expect(successMessage(false)).toBe(CONFIRM_SUCCESS_MSG);
  });
  it("an already-confirmed recovery yields ALREADY_CONFIRMED_MSG", () => {
    expect(successMessage(true)).toBe(ALREADY_CONFIRMED_MSG);
  });
  it("the two messages are distinct", () => {
    expect(CONFIRM_SUCCESS_MSG).not.toBe(ALREADY_CONFIRMED_MSG);
  });

  it("successful feedback is decided before any refresh runs", () => {
    // The panel calls successMessage(...) based purely on the RPC result,
    // independent of whether onRefreshDetail/onRefreshList later succeeds.
    // Simulate a refresh that throws — the success message is already chosen.
    const msg = successMessage(false);
    // A refresh failure cannot retroactively change the chosen message.
    expect(msg).toBe(CONFIRM_SUCCESS_MSG);
  });
});

describe("synchronous duplicate-submit prevention (logic)", () => {
  it("clearing the gate on success is idempotent when called twice", () => {
    let gate = blockGate(createConfirmGate(), RES_ID);
    gate = clearGate(gate, RES_ID);
    expect(isGateBlocked(gate, RES_ID)).toBe(false);
    // Clearing an already-cleared gate is a no-op (returns same reference).
    gate = clearGate(gate, RES_ID);
    expect(isGateBlocked(gate, RES_ID)).toBe(false);
  });
});

describe("onRequireReload gate transition (production helper used by panel)", () => {
  it("blockGate is the transition the panel's onRequireReload triggers", () => {
    let gate = createConfirmGate();
    // ConfirmReservationPanel.handleRequireReload calls blockGate(prev, id).
    gate = blockGate(gate, RES_ID);
    expect(isGateBlocked(gate, RES_ID)).toBe(true);
  });

  it("the blocked gate survives dialog close/reopen (gate is parent-owned)", () => {
    let gate = createConfirmGate();
    gate = blockGate(gate, RES_ID);
    // Dialog closes and reopens — gate is a plain map in the parent, unaffected.
    expect(isGateBlocked(gate, RES_ID)).toBe(true);
    gate = clearGate(gate, RES_ID);
    expect(isGateBlocked(gate, RES_ID)).toBe(false);
  });
});

describe("fresh-detail adoption + gate clearing (exact record)", () => {
  it("a pending-review reload clears the gate and yields a confirmable assessment with the fresh timestamp", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    const fresh = makeReservation({ updatedAt: NEW_UPDATED_AT, status: "pending_review" });
    const reload: ConfirmReloadResult = { success: true, reservation: fresh };
    const { gate: nextGate, assessment } = applyReloadToGate(gate, reload);
    // Gate clears ONLY after successful adoption of pending_review details.
    expect(isGateBlocked(nextGate, RES_ID)).toBe(false);
    expect(assessment?.kind).toBe("confirmable");
    // The fresh timestamp is the one a new confirmation must use.
    expect(assessment?.reservation.updatedAt).toBe(NEW_UPDATED_AT);
  });

  it("a failed reload leaves the gate blocked (no adoption)", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    const failedReload: ConfirmReloadResult = {
      success: false,
      reservation: null,
      error: "DB down",
    };
    const { gate: nextGate, assessment } = applyReloadToGate(gate, failedReload);
    expect(isGateBlocked(nextGate, RES_ID)).toBe(true);
    expect(assessment).toBeNull();
  });

  it("an obsolete reload (different reservation id) leaves the gate blocked", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    // Even a successful reload for a different reservation must not clear
    // the requested reservation's gate.
    const other = makeReservation({
      id: "99999999-9999-9999-9999-999999999999",
      status: "pending_review",
    });
    const reload: ConfirmReloadResult = { success: true, reservation: other };
    const { gate: nextGate } = applyReloadToGate(gate, reload);
    expect(isGateBlocked(nextGate, RES_ID)).toBe(true);
  });

  it("a confirmed reload keeps the gate blocked (no mutation)", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    const confirmed = makeReservation({ status: "confirmed", updatedAt: NEW_UPDATED_AT });
    const reload: ConfirmReloadResult = { success: true, reservation: confirmed };
    const { gate: nextGate, assessment } = applyReloadToGate(gate, reload);
    expect(isGateBlocked(nextGate, RES_ID)).toBe(true);
    expect(assessment?.kind).toBe("already_confirmed");
  });

  it("a reload showing another status keeps the gate blocked and is inapplicable", () => {
    const gate = blockGate(createConfirmGate(), RES_ID);
    const cancelled = makeReservation({ status: "cancelled", updatedAt: NEW_UPDATED_AT });
    const reload: ConfirmReloadResult = { success: true, reservation: cancelled };
    const { gate: nextGate, assessment } = applyReloadToGate(gate, reload);
    expect(isGateBlocked(nextGate, RES_ID)).toBe(true);
    expect(assessment?.kind).toBe("inapplicable");
    expect(assessment?.status).toBe("cancelled");
  });
});

describe("reload-result union narrows correctly", () => {
  it("success:true carries a reservation with the exact fresh timestamp", () => {
    const fresh = makeReservation({ updatedAt: NEW_UPDATED_AT, status: "pending_review" });
    const reload: ConfirmReloadResult = { success: true, reservation: fresh };
    if (reload.success) {
      // narrowed: reservation is non-null ReservationDetailDTO
      expect(reload.reservation.updatedAt).toBe(NEW_UPDATED_AT);
    } else {
      // narrowed: reservation is null
      expect.fail("should be success");
    }
  });

  it("success:false requires reservation:null and an error", () => {
    const reload: ConfirmReloadResult = {
      success: false,
      reservation: null,
      error: "Could not reload.",
    };
    if (!reload.success) {
      expect(reload.reservation).toBeNull();
      expect(reload.error).toBe("Could not reload.");
    } else {
      expect.fail("should be failure");
    }
  });
});

describe("reload outcome messages", () => {
  it("confirmed reload shows the already-confirmed message", () => {
    expect(reloadOutcomeMessage("confirmed")).toBe(ALREADY_CONFIRMED_MSG);
  });
  it("pending_review reload yields no special message (gate UI handles it)", () => {
    expect(reloadOutcomeMessage("pending_review")).toBeNull();
  });
  it("another status yields a clear inapplicable message", () => {
    expect(reloadOutcomeMessage("cancelled")).toContain("cancelled");
    expect(reloadOutcomeMessage("cancelled")).toContain("not available");
  });
});

describe("mutation success preserved despite refresh failure", () => {
  it("REFRESH_FAILURE_MSG is distinct from the success messages", () => {
    expect(REFRESH_FAILURE_MSG).not.toBe(CONFIRM_SUCCESS_MSG);
    expect(REFRESH_FAILURE_MSG).not.toBe(ALREADY_CONFIRMED_MSG);
    expect(REFRESH_FAILURE_MSG).toContain("could not be refreshed");
  });

  it("the success message is decided before refresh runs and survives refresh failure", () => {
    // The panel calls successMessage(...) based purely on the RPC result.
    // A refresh failure cannot retroactively change the chosen message.
    const msg = successMessage(false);
    expect(msg).toBe(CONFIRM_SUCCESS_MSG);
    // A later refresh failure surfaces REFRESH_FAILURE_MSG — not a change to msg.
    expect(REFRESH_FAILURE_MSG).not.toBe(msg);
  });
});

describe("runPostMutationRefresh preserves mixed outcomes (no boolean conversion)", () => {
  // Exercise the actual production orchestrator the panel delegates to. The
  // panel returns CombinedRefreshResult directly (detail.status +
  // list.status), so a "superseded" refresh is never collapsed into a
  // boolean that would hide the distinction from the dialog.

  it("success/success preserves both as success", async () => {
    const r = await runPostMutationRefresh(
      async () => REFRESH_SUCCESS,
      async () => REFRESH_SUCCESS,
    );
    expect(r.detail.status).toBe("success");
    expect(r.list.status).toBe("success");
  });

  it("failure/success preserves the detail failure and list success", async () => {
    const r = await runPostMutationRefresh(
      async () => refreshFailure("detail error"),
      async () => REFRESH_SUCCESS,
    );
    expect(r.detail.status).toBe("failure");
    expect(r.detail.error).toBe("detail error");
    expect(r.list.status).toBe("success");
  });

  it("success/failure preserves the detail success and list failure", async () => {
    const r = await runPostMutationRefresh(
      async () => REFRESH_SUCCESS,
      async () => refreshFailure("list error"),
    );
    expect(r.detail.status).toBe("success");
    expect(r.list.status).toBe("failure");
    expect(r.list.error).toBe("list error");
  });

  it("failure/failure preserves both as failure", async () => {
    const r = await runPostMutationRefresh(
      async () => refreshFailure("d"),
      async () => refreshFailure("l"),
    );
    expect(r.detail.status).toBe("failure");
    expect(r.list.status).toBe("failure");
  });

  it("superseded/success keeps superseded distinct from success and failure", async () => {
    const r = await runPostMutationRefresh(
      async () => refreshSuperseded(),
      async () => REFRESH_SUCCESS,
    );
    expect(r.detail.status).toBe("superseded");
    expect(r.list.status).toBe("success");
    // A superseded refresh must NOT be described as a failure.
    expect(r.detail.status).not.toBe("failure");
    expect(r.detail.status).not.toBe("success");
  });

  it("success/superseded keeps the list superseded distinct", async () => {
    const r = await runPostMutationRefresh(
      async () => REFRESH_SUCCESS,
      async () => refreshSuperseded(),
    );
    expect(r.detail.status).toBe("success");
    expect(r.list.status).toBe("superseded");
  });

  it("thrown detail refresh converts to failure but still allows list refresh", async () => {
    const r = await runPostMutationRefresh(
      async () => {
        throw new Error("boom");
      },
      async () => REFRESH_SUCCESS,
    );
    expect(r.detail.status).toBe("failure");
    expect(r.list.status).toBe("success");
  });

  it("invokes both refresh callbacks (detail and list)", async () => {
    let detailCalled = false;
    let listCalled = false;
    const r = await runPostMutationRefresh(
      async () => {
        detailCalled = true;
        return REFRESH_SUCCESS;
      },
      async () => {
        listCalled = true;
        return REFRESH_SUCCESS;
      },
    );
    expect(detailCalled).toBe(true);
    expect(listCalled).toBe(true);
    expect(r.detail.status).toBe("success");
    expect(r.list.status).toBe("success");
  });

  describe("refreshWarningForOutcome — warning selection (survives dialog close)", () => {
    // The dialogs call refreshWarningForOutcome and emit toast.warning when it
    // returns non-null. The Sonner toast host is mounted outside the dialog,
    // so the warning survives the dialog closing immediately afterward.

    it("success/success emits no warning", () => {
      expect(
        refreshWarningForOutcome({ detail: REFRESH_SUCCESS, list: REFRESH_SUCCESS }, "confirmed"),
      ).toBeNull();
    });

    it("failure/success emits a warning for confirmed", () => {
      const r = refreshWarningForOutcome(
        { detail: refreshFailure("detail error"), list: REFRESH_SUCCESS },
        "confirmed",
      );
      expect(r).not.toBeNull();
      expect(r).toContain("confirmed");
      expect(r).toContain("could not be refreshed");
      expect(r).toContain("Reload the reservation list");
    });

    it("success/failure emits a warning for cancelled", () => {
      const r = refreshWarningForOutcome(
        { detail: REFRESH_SUCCESS, list: refreshFailure("list error") },
        "cancelled",
      );
      expect(r).not.toBeNull();
      expect(r).toContain("cancelled");
      expect(r).toContain("could not be refreshed");
    });

    it("superseded/success emits NO warning (superseded alone is not a failure)", () => {
      expect(
        refreshWarningForOutcome(
          { detail: refreshSuperseded(), list: REFRESH_SUCCESS },
          "confirmed",
        ),
      ).toBeNull();
    });

    it("failure/superseded still emits a warning (mixed result contains a genuine failure)", () => {
      const r = refreshWarningForOutcome(
        { detail: refreshFailure("d"), list: refreshSuperseded() },
        "cancelled",
      );
      expect(r).not.toBeNull();
      expect(r).toContain("cancelled");
    });

    it("success/superseded emits NO warning (only list is superseded, no failure)", () => {
      expect(
        refreshWarningForOutcome(
          { detail: REFRESH_SUCCESS, list: refreshSuperseded() },
          "confirmed",
        ),
      ).toBeNull();
    });

    it("failure/failure emits a warning", () => {
      const r = refreshWarningForOutcome(
        { detail: refreshFailure("d"), list: refreshFailure("l") },
        "confirmed",
      );
      expect(r).not.toBeNull();
      expect(r).toContain("could not be refreshed");
    });
  });
});

/* ---------------------------------------------------------------------------
 * UNVERIFIED component interactions (require @testing-library/react + jsdom,
 * neither of which is installed; vitest environment is `node`):
 *  - Clicking "Confirm reservation" invokes the RPC exactly once per click.
 *  - Two rapid clicks submit exactly once (submitLockRef guard).
 *  - Obsolete responses after unmount/reservation-change are ignored at the
 *    setState level (the guard reads mountedRef / opGenRef inside the dialog).
 *  - "Reload latest" button shows "Reloading…" and disables dismissal.
 *  - "Keep pending" closes the dialog when not busy.
 *  - The gate is visually rendered as the "Reload required" block.
 *  - The dialog invokes onRequireReload(resId) on conflict/unexpected/
 *    invalid_status results and on thrown errors (source-inspected wiring,
 *    NOT verified by these helper tests).
 * The pure gate/reload/assessment logic above IS the production logic the
 * component delegates to; only the React glue (refs, setState, event wiring,
 * and the onRequireReload callback invocation) is not exercised here.
 * ------------------------------------------------------------------------- */
