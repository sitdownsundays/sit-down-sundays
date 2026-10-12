/**
 * Reservation submission lifecycle controller — framework-agnostic.
 *
 * Owns the idempotency key, the exact submitted payload, and the submission
 * phase. Lives in the parent wizard (via useSubmissionController) so it
 * SURVIVES ReviewStep unmounting: if the review step is replaced during a step
 * change, the key + payload are retained and a remounted review step cannot
 * silently generate a new key and submit a duplicate.
 *
 * OUTCOME CLASSIFICATION (not string matching):
 *  - success:    the server confirmed the request was saved.
 *  - rejected:   the server PROVED no request was saved (a deterministic,
 *                 pre-write validation failure or a proven rollback). Only this
 *                 phase unlocks editing or a new idempotency key.
 *  - uncertain:  the persistence outcome is unknown (network/timeout OR a
 *                 generic infrastructure failure that may or may not have
 *                 written). Edit/Back are BLOCKED; only same-key/payload retry
 *                 is allowed. A new/edited payload is NOT permitted until a
 *                 definitive response proves the previous request was not saved.
 *
 * Phases (derived from the outcome):
 *  - idle:        no submission in flight; a new request may start.
 *  - submitting:  a request is in flight; nothing else may start.
 *  - uncertain:   unknown outcome (see above).
 *  - rejected:    proven no-write failure. Edit/Back + new/edited submit OK.
 *  - success:     saved. Resubmission blocked.
 *
 * PII (contact details, notes, payload) is kept only in memory (the controller
 * instance). It is never written to localStorage, URLs, or logs. The instance
 * does not survive a full browser reload — that limitation is documented.
 */
import type {
  SubmitReservationRequestInput,
  SubmitReservationResult,
  SubmissionOutcome,
} from "@/lib/reservation/types";
import { generateIdempotencyKey } from "@/lib/booking/submit-helpers";

export type SubmissionPhase =
  "idle" | "submitting" | "uncertain" | "rejected" | "key_mismatch" | "success";

export type { SubmissionOutcome };

export interface SubmissionControllerOptions {
  /** The real submit server function adapter. */
  submit: (input: { data: SubmitReservationRequestInput }) => Promise<SubmitReservationResult>;
  /** Injectable for tests; defaults to Web Crypto generation. */
  generateKey?: () => string | null;
}

const UNCERTAIN_MESSAGE =
  "We couldn't confirm whether your request was received. Retry to check its status — we'll reuse your exact request so no duplicate is created.";
const REJECTED_MESSAGE = "We couldn't submit your request. Please try again.";
const KEY_MISMATCH_MESSAGE =
  "We couldn't verify this request. A reservation may already exist. Please contact our team before submitting another request.";

/**
 * Classify a resolved submit result into a deterministic outcome WITHOUT
 * matching human-readable error strings. The server tags proven rejections
 * with `outcome: "proven_rejection"` (and a `rejectionCode`); confirmed saves
 * use `outcome: "confirmed_success"`. Anything else with `success:false` and
 * no proven-rejection tag is conservatively uncertain (persistence outcome
 * unknown).
 */
export function classifyOutcome(res: SubmitReservationResult): SubmissionOutcome {
  if (res.outcome) return res.outcome;
  // Fallback for results that predate the outcome tag: success is confirmed;
  // a failure without a proven-rejection tag is uncertain.
  if (res.success) return "confirmed_success";
  return "uncertain";
}

type Listener = () => void;

export class SubmissionController {
  phase: SubmissionPhase = "idle";
  key: string | null = null;
  payload: SubmitReservationRequestInput | null = null;
  result: SubmitReservationResult | null = null;
  error: string | null = null;

  private submitting = false;
  private readonly submitFn: SubmissionControllerOptions["submit"];
  private readonly generateKeyFn: () => string | null;
  private listeners = new Set<Listener>();

  constructor(opts: SubmissionControllerOptions) {
    this.submitFn = opts.submit;
    this.generateKeyFn = opts.generateKey ?? generateIdempotencyKey;
  }

  /** Subscribe to phase transitions (used by the React hook for reactivity). */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /** Whether Edit/Back navigation is permitted (no in-flight or uncertain request). */
  canEditOrBack(): boolean {
    return this.phase === "idle" || this.phase === "rejected";
  }

  /** Whether a brand-new submission may start. */
  canStartNew(): boolean {
    return this.phase === "idle" || this.phase === "rejected";
  }

  /** Whether a same-key/payload retry may run (uncertain or rejected). */
  canRetry(): boolean {
    return this.phase === "uncertain" || this.phase === "rejected";
  }

  /** Whether the terminal success state is reached. */
  isComplete(): boolean {
    return this.phase === "success";
  }

  /**
   * Whether the last result was an idempotency-key mismatch — the server PROVED
   * the submitted key was already used for a DIFFERENT reservation. A row MAY
   * already exist under that key with different terms. Reset/new-key submission
   * is BLOCKED (could create a duplicate); only staff reconciliation is safe.
   * The original key and payload are preserved.
   */
  isKeyMismatch(): boolean {
    return this.phase === "key_mismatch";
  }

  /**
   * Start a NEW submission. Builds a fresh key + payload via buildPayload.
   * Reused for an edited request after a definitive rejection. If the outcome
   * is uncertain, the caller MUST use retry() instead.
   */
  async start(
    buildPayload: (idempotencyKey: string) => SubmitReservationRequestInput,
  ): Promise<void> {
    if (this.submitting) return;
    if (this.isComplete()) return;
    if (this.phase === "uncertain") return; // must retry, not start anew
    if (this.phase === "key_mismatch") return; // a row may exist; new key could duplicate
    if (!this.canStartNew()) return;

    const key = this.generateKeyFn();
    if (key === null) {
      // Secure generation unavailable — surface as a definitive rejection.
      this.phase = "rejected";
      this.error =
        "Secure request generation is unavailable in this browser. Please use a modern browser and try again.";
      this.notify();
      return;
    }
    this.key = key;
    this.payload = buildPayload(key);
    this.result = null;
    await this.run();
  }

  /**
   * Retry the SAME key + payload to recover the original result. Used after an
   * uncertain outcome (timeout/network) or a definitive rejection. Does NOT
   * rebuild the payload, so an expired quote or changed configuration does not
   * block recovery — the backend idempotency lookup recovers the original
   * request.
   */
  async retry(): Promise<void> {
    if (this.submitting) return;
    if (!this.canRetry()) return;
    if (!this.payload || !this.key) return;
    await this.run();
  }

  /**
   * Reset to idle so a new/edited payload can be submitted. Permitted ONLY after
   * a definitive rejection (the server confirmed nothing was saved). Never
   * permitted while uncertain — that could create a duplicate.
   */
  resetForNewRequest(): void {
    if (this.phase !== "rejected") return;
    this.key = null;
    this.payload = null;
    this.result = null;
    this.error = null;
    this.phase = "idle";
    this.notify();
  }

  private async run(): Promise<void> {
    this.submitting = true;
    this.phase = "submitting";
    this.error = null;
    this.notify(); // publish submitting phase immediately
    try {
      const res = await this.submitFn({ data: this.payload! });
      this.result = res;
      const outcome = classifyOutcome(res);
      if (outcome === "confirmed_success") {
        this.phase = "success";
      } else if (
        outcome === "proven_rejection" &&
        res.rejectionCode === "idempotency_key_mismatch"
      ) {
        // The server PROVED the key was already used for a DIFFERENT
        // reservation. A row MAY already exist under that key with different
        // terms. Do NOT unlock editing or a new key — that could create a
        // duplicate. Preserve the original key + payload and require staff
        // reconciliation. This is distinct from an ordinary proven rejection
        // (nothing was saved).
        this.phase = "key_mismatch";
        this.error = res.error ?? KEY_MISMATCH_MESSAGE;
      } else if (outcome === "proven_rejection") {
        this.phase = "rejected";
        this.error = res.error ?? REJECTED_MESSAGE;
      } else {
        // uncertain — persistence outcome unknown.
        this.phase = "uncertain";
        this.error = res.error ?? UNCERTAIN_MESSAGE;
      }
    } catch {
      // Network/timeout: the request MAY already be saved. Mark uncertain and
      // retain the exact key + payload so retry recovers the original result.
      this.phase = "uncertain";
      this.error = UNCERTAIN_MESSAGE;
    } finally {
      this.submitting = false;
      this.notify();
    }
  }
}
