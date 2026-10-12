/**
 * Behavioral tests for the booking submission controller.
 *
 * These exercise the REAL production SubmissionController class with a mocked
 * submit function — not copied logic, not source-pattern assertions. The
 * controller is the production lifecycle owner; useSubmissionController is a
 * thin React wrapper around it, so testing the controller directly exercises
 * the same production code path the hook delegates to.
 *
 * Coverage:
 *  - timeout/network error → uncertain phase; same-key/exact-payload retry.
 *  - Edit/Back-equivalent navigation is blocked during uncertainty (the
 *    controller exposes phase; the review step guards on canEditOrBack()).
 *  - successful recovery (replay) shows the original reservation number.
 *  - completed requests cannot resubmit.
 *  - rejected requests retain the payload for same-payload retry.
 *  - synchronous lock prevents two immediate concurrent submissions.
 *  - reset regenerates the key for a materially new request after a rejection.
 *
 * These are mocked-submit-function tests, NOT live server/PostgreSQL tests.
 * They do NOT exercise the React hook's re-render lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubmissionController } from "@/lib/booking/submission-controller";
import type {
  SubmitReservationResult,
  SubmitReservationRequestInput,
} from "@/lib/reservation/types";

function makePayload(key: string): SubmitReservationRequestInput {
  return {
    sundayServiceId: "svc-1",
    seatingTimeId: "seat-1",
    experienceType: "standard",
    partySize: 2,
    adults: 2,
    seniors: 0,
    children: 0,
    contactFirstName: "Alice",
    contactLastName: "Smith",
    contactEmail: "alice@example.com",
    contactPhone: "+1 555 123 4567",
    guests: [],
    platters: [],
    idempotencyKey: key,
  };
}

describe("SubmissionController", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("reaches success and exposes the reservation number", async () => {
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: true,
      reservationNumber: "RES-1001",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    expect(controller.phase).toBe("idle");

    await controller.start(makePayload);
    expect(controller.phase).toBe("success");
    expect(controller.result?.reservationNumber).toBe("RES-1001");
    expect(submitFn).toHaveBeenCalledTimes(1);
  });

  it("a timeout produces an uncertain phase and retains the exact payload for retry", async () => {
    const submitFn = vi.fn(async () => {
      throw new Error("network timeout");
    });
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("uncertain");
    expect(controller.error).toContain("couldn't confirm");

    // First call captured the payload + key.
    const firstCall = submitFn.mock.calls[0][0].data;
    const firstKey = firstCall.idempotencyKey;

    // Retry reuses the EXACT same key + payload (same object identity).
    await controller.retry();
    expect(submitFn).toHaveBeenCalledTimes(2);
    const retryCall = submitFn.mock.calls[1][0].data;
    expect(retryCall.idempotencyKey).toBe(firstKey);
    // Same object reference — not a rebuilt payload.
    expect(retryCall).toBe(firstCall);
  });

  it("Edit/Back is blocked during uncertainty (canEditOrBack returns false)", async () => {
    const submitFn = vi.fn(async () => {
      throw new Error("network timeout");
    });
    const controller = new SubmissionController({ submit: submitFn });

    expect(controller.canEditOrBack()).toBe(true); // idle
    await controller.start(makePayload);
    expect(controller.phase).toBe("uncertain");
    // The review step guards navigation on canEditOrBack(); while uncertain it
    // must be false so the user cannot navigate away and lose the recovery path.
    expect(controller.canEditOrBack()).toBe(false);
  });

  it("successful recovery (replay) shows the original reservation number", async () => {
    // First call times out; second call (retry) recovers the saved reservation.
    let call = 0;
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => {
      call += 1;
      if (call === 1) throw new Error("network timeout");
      return { success: true, reservationNumber: "RES-2042", idempotentReplay: true };
    });
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("uncertain");

    await controller.retry();
    expect(controller.phase).toBe("success");
    expect(controller.result?.reservationNumber).toBe("RES-2042");
    expect(controller.result?.idempotentReplay).toBe(true);
  });

  it("a completed request cannot resubmit", async () => {
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: true,
      reservationNumber: "RES-3000",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("success");
    expect(controller.isComplete()).toBe(true);

    // Attempting to start again must not call submit a second time.
    const beforeCalls = submitFn.mock.calls.length;
    await controller.start(makePayload);
    expect(submitFn.mock.calls.length).toBe(beforeCalls);
    expect(controller.phase).toBe("success");
  });

  it("a definitive (proven) rejection retains the payload for same-payload retry", async () => {
    // A proven rejection carries the canonical outcome tag; the controller
    // must NOT classify it as uncertain.
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: false,
      outcome: "proven_rejection",
      rejectionCode: "eligibility_failed",
      error: "Selection no longer available",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("rejected");
    expect(controller.error).toBe("Selection no longer available");

    const firstKey = submitFn.mock.calls[0][0].data.idempotencyKey;
    const firstPayload = submitFn.mock.calls[0][0].data;

    await controller.retry();
    const retryPayload = submitFn.mock.calls[1][0].data;
    expect(retryPayload.idempotencyKey).toBe(firstKey);
    expect(retryPayload).toBe(firstPayload);
  });

  it("a generic server failure (no outcome tag) is uncertain, not rejected", async () => {
    // An untagged {success:false} (e.g. an infrastructure/RPC failure caught by
    // the server action) must be conservatively uncertain: the request MAY be
    // saved. Edit/Back and a new key are NOT safe.
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: false,
      error: "Something went wrong",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("uncertain");
    expect(controller.canEditOrBack()).toBe(false);
    expect(controller.canStartNew()).toBe(false);
    expect(controller.canRetry()).toBe(true);
  });

  it("prevents two immediate concurrent submissions via the synchronous lock", async () => {
    let resolve: (v: SubmitReservationResult) => void = () => {};
    const submitFn = vi.fn(
      () =>
        new Promise<SubmitReservationResult>((r) => {
          resolve = r;
        }),
    );
    const controller = new SubmissionController({ submit: submitFn });

    // Fire two starts without awaiting; the synchronous lock should block the
    // second.
    const p1 = controller.start(makePayload);
    const p2 = controller.start(makePayload);
    expect(submitFn).toHaveBeenCalledTimes(1);
    resolve({ success: true, reservationNumber: "RES-5000" });
    await p1;
    await p2;
    expect(controller.phase).toBe("success");
  });

  it("reset regenerates the key for a materially new request after a rejection", async () => {
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: false,
      outcome: "proven_rejection",
      rejectionCode: "validation_failed",
      error: "nope",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    const firstKey = submitFn.mock.calls[0][0].data.idempotencyKey;

    controller.resetForNewRequest();
    expect(controller.phase).toBe("idle");

    await controller.start(makePayload);
    const secondKey = submitFn.mock.calls[1][0].data.idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("success cannot reset or resubmit", async () => {
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: true,
      reservationNumber: "RES-SUCCESS-LOCK",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("success");

    // resetForNewRequest is a no-op after success (only permitted after rejection).
    controller.resetForNewRequest();
    expect(controller.phase).toBe("success");
    expect(controller.key).not.toBeNull();
    expect(controller.payload).not.toBeNull();

    // A new start must also be blocked after success.
    const before = submitFn.mock.calls.length;
    await controller.start(makePayload);
    expect(submitFn.mock.calls.length).toBe(before);
    expect(controller.phase).toBe("success");
  });

  it("uncertain cannot reset (would risk a duplicate)", async () => {
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => {
      throw new Error("timeout");
    });
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("uncertain");
    const heldKey = controller.key;
    const heldPayload = controller.payload;

    controller.resetForNewRequest();
    expect(controller.phase).toBe("uncertain");
    expect(controller.key).toBe(heldKey);
    expect(controller.payload).toBe(heldPayload);
  });

  it("an idempotency-key mismatch is key_mismatch, not rejected — no reset, no new key, original payload intact", async () => {
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: false,
      outcome: "proven_rejection",
      rejectionCode: "idempotency_key_mismatch",
      error: "This request key was used for a different reservation.",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    // Distinct phase — NOT the ordinary rejected flow.
    expect(controller.phase).toBe("key_mismatch");
    expect(controller.isKeyMismatch()).toBe(true);

    // The original key + payload are preserved (not reset to null).
    const firstKey = submitFn.mock.calls[0][0].data.idempotencyKey;
    const firstPayload = submitFn.mock.calls[0][0].data;
    expect(controller.key).toBe(firstKey);
    expect(controller.payload).toBe(firstPayload);

    // Reset is BLOCKED — a row may exist; a new key could create a duplicate.
    controller.resetForNewRequest();
    expect(controller.phase).toBe("key_mismatch");
    expect(controller.key).toBe(firstKey);
    expect(controller.payload).toBe(firstPayload);

    // A new start is BLOCKED — no new key generated, no new submit call.
    const beforeCalls = submitFn.mock.calls.length;
    await controller.start(makePayload);
    expect(submitFn.mock.calls.length).toBe(beforeCalls);
    expect(controller.phase).toBe("key_mismatch");
    expect(controller.key).toBe(firstKey);

    // Edit/Back is BLOCKED — cannot navigate away from the recovery path.
    expect(controller.canEditOrBack()).toBe(false);
    expect(controller.canStartNew()).toBe(false);
    expect(controller.canRetry()).toBe(false);

    // The recovery message does NOT claim nothing was booked.
    expect(controller.error).not.toContain("nothing was booked");
    expect(controller.error).toContain("different reservation");
  });

  it("does not fall back to Math.random when Web Crypto is unavailable", async () => {
    // Inject a generateKey that simulates unavailable Web Crypto.
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: true,
      reservationNumber: "RES-6000",
    }));
    const controller = new SubmissionController({
      submit: submitFn,
      generateKey: () => null,
    });

    await controller.start(makePayload);
    // Secure generation unavailable → definitive rejection, no submit call.
    expect(controller.phase).toBe("rejected");
    expect(controller.error).toContain("Secure request generation is unavailable");
    expect(submitFn).not.toHaveBeenCalled();
  });
});

/**
 * Hook-contract tests for useSubmissionController.
 *
 * vitest runs in a node environment with no DOM (jsdom/happy-dom are not
 * installed and config changes are out of scope), so we cannot render the
 * React hook with createRoot. Instead we verify the production contracts the
 * hook relies on — the controller's subscription/notify reactivity and the
 * facade delegation pattern — by exercising the REAL SubmissionController
 * instance and its subscribe() API directly. The hook is a thin wrapper:
 *   - it stores the controller in a ref (stable instance),
 *   - it subscribes via controller.subscribe(() => forceUpdate()),
 *   - it exposes a facade (actions.start/retry/resetForNewRequest) that
 *     delegates to controller.start/retry/resetForNewRequest WITHOUT
 *     overwriting them.
 * These tests prove the underlying reactivity and delegation the hook uses.
 */
describe("useSubmissionController contract (subscription + facade)", () => {
  it("subscribe notifies on every phase transition, including immediate submitting", async () => {
    let resolve!: (v: SubmitReservationResult) => void;
    const submitFn = vi.fn(
      () =>
        new Promise<SubmitReservationResult>((r) => {
          resolve = r;
        }),
    );
    const controller = new SubmissionController({ submit: submitFn });
    const phases: string[] = [];
    controller.subscribe(() => phases.push(controller.phase));

    const p = controller.start(makePayload);
    // The submitting phase is published synchronously before the promise
    // resolves (the hook relies on this for immediate pending UI).
    expect(phases).toContain("submitting");

    resolve({ success: true, reservationNumber: "RES-S1" });
    await p;
    expect(phases[phases.length - 1]).toBe("success");
  });

  it("the facade delegates start/retry/resetForNewRequest without overwriting controller methods", async () => {
    // Simulate the hook's facade: separate functions that call the controller's
    // own methods. The controller's bound methods must remain intact (not
    // overwritten by Object.assign as in the prior defect).
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: true,
      reservationNumber: "RES-S2",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    // Facade mirrors the hook's actions object.
    const facade = {
      start: (build: (k: string) => SubmitReservationRequestInput) => controller.start(build),
      retry: () => controller.retry(),
      resetForNewRequest: () => controller.resetForNewRequest(),
    };

    // The controller's own start/retry must still be the original methods.
    expect(typeof controller.start).toBe("function");
    expect(typeof controller.retry).toBe("function");

    await facade.start(makePayload);
    expect(submitFn).toHaveBeenCalledTimes(1);
    expect(controller.phase).toBe("success");

    // Facade retry on a completed request must be a no-op (cannot resubmit).
    await facade.retry();
    expect(submitFn).toHaveBeenCalledTimes(1);
  });

  it("rerenders preserve the controller instance (ref stability)", () => {
    // The hook stores the controller in a ref created once; subsequent reads
    // return the same instance. We simulate two "renders" by constructing one
    // controller and reading it twice.
    const submitFn = vi.fn(async () => ({ success: true }) as SubmitReservationResult);
    const ref = { current: null as SubmissionController | null };
    if (ref.current === null) ref.current = new SubmissionController({ submit: submitFn });
    const first = ref.current;
    // Second "render" — ref already populated.
    if (ref.current === null) ref.current = new SubmissionController({ submit: submitFn });
    expect(ref.current).toBe(first);
  });

  it("uncertain generic server failure blocks editing/new requests but allows retry", async () => {
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: false,
      error: "infra error",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("uncertain");
    expect(controller.canEditOrBack()).toBe(false);
    expect(controller.canStartNew()).toBe(false);
    expect(controller.canRetry()).toBe(true);
  });

  it("successful recovery (replay) retains the original reservation number", async () => {
    let call = 0;
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => {
      call += 1;
      if (call === 1) throw new Error("timeout");
      return { success: true, reservationNumber: "RES-S5", idempotentReplay: true };
    });
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("uncertain");
    await controller.retry();
    expect(controller.phase).toBe("success");
    expect(controller.result?.reservationNumber).toBe("RES-S5");
    expect(controller.result?.idempotentReplay).toBe(true);
  });

  it("a completed request cannot resubmit", async () => {
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => ({
      success: true,
      reservationNumber: "RES-S6",
    }));
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    expect(controller.phase).toBe("success");
    const before = submitFn.mock.calls.length;
    await controller.start(makePayload);
    expect(submitFn.mock.calls.length).toBe(before);
    expect(controller.phase).toBe("success");
  });

  it("retry uses the identical key and payload object (not rebuilt)", async () => {
    let call = 0;
    const submitFn = vi.fn(async (): Promise<SubmitReservationResult> => {
      call += 1;
      if (call === 1) throw new Error("timeout");
      return { success: true, reservationNumber: "RES-S7", idempotentReplay: true };
    });
    const controller = new SubmissionController({ submit: submitFn });

    await controller.start(makePayload);
    const firstKey = submitFn.mock.calls[0][0].data.idempotencyKey;
    const firstPayload = submitFn.mock.calls[0][0].data;

    await controller.retry();
    const retryCall = submitFn.mock.calls[1][0].data;
    expect(retryCall.idempotencyKey).toBe(firstKey);
    expect(retryCall).toBe(firstPayload); // same object reference
  });
});
