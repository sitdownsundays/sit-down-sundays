/**
 * React hook that owns the SubmissionController for the booking wizard.
 *
 * The controller is created once and stored in a ref in the PARENT wizard, so
 * it survives ReviewStep unmounting when the user navigates between steps.
 * A remounted review step reads the existing controller — it cannot silently
 * generate a new key and submit a duplicate.
 *
 * The hook NEVER overwrites the controller's own `start`/`retry` methods. It
 * exposes a separate facade (`actions`) that delegates to the controller, and
 * re-renders via a subscription whenever the controller's phase changes. The
 * submitting phase is published immediately (before the deferred promise
 * resolves) so the rendered UI shows pending state and disabled controls while
 * a submission remains unresolved.
 *
 * Client-safe; the submit function is injected by the wizard.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { SubmissionController, type SubmissionPhase } from "@/lib/booking/submission-controller";
import type {
  SubmitReservationRequestInput,
  SubmitReservationResult,
} from "@/lib/reservation/types";

export interface UseSubmissionController {
  /** The underlying controller instance (stable across renders). */
  controller: SubmissionController;
  /** Current phase (reactive — re-renders on transition). */
  phase: SubmissionPhase;
  /** Facade actions that delegate to the controller without overwriting it. */
  actions: {
    start: (buildPayload: (key: string) => SubmitReservationRequestInput) => Promise<void>;
    retry: () => Promise<void>;
    resetForNewRequest: () => void;
  };
}

export function useSubmissionController(
  submit: (input: { data: SubmitReservationRequestInput }) => Promise<SubmitReservationResult>,
): UseSubmissionController {
  const ref = useRef<SubmissionController | null>(null);
  if (ref.current === null) {
    ref.current = new SubmissionController({ submit });
  }
  const controller = ref.current;

  // Re-render on every controller phase transition (including the immediate
  // "submitting" publication). useReducer's dispatch is stable and forces a
  // fresh read of controller.phase on each notification.
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsub = controller.subscribe(() => forceUpdate());
    return unsub;
  }, [controller]);

  const start = useCallback(
    async (buildPayload: (key: string) => SubmitReservationRequestInput) => {
      await controller.start(buildPayload);
    },
    [controller],
  );

  const retry = useCallback(async () => {
    await controller.retry();
  }, [controller]);

  const resetForNewRequest = useCallback(() => {
    controller.resetForNewRequest();
  }, [controller]);

  return {
    controller,
    phase: controller.phase,
    actions: { start, retry, resetForNewRequest },
  };
}
