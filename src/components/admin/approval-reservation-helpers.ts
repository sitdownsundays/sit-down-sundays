/**
 * Approval Reservation — pure client-safe helpers.
 *
 * Server authorization (reservations.manage) and the
 * approve_reservation_for_payment_atomic RPC remain authoritative for
 * approval eligibility, capacity validity, deadline computation, and the
 * atomic approval decision. These helpers only drive UI gating, payload
 * assembly, and reload assessment.
 *
 * Approval authorizes the deposit-payment window; it does NOT collect money,
 * satisfy the deposit, confirm the reservation, or change payment status.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";
import type { ApprovalBalanceDeadlineType } from "@/lib/sundays/types";

/** Statuses from which the 0022 RPC permits approval. */
const APPROVAL_ELIGIBLE_STATUSES = [
  "pending_review",
  "confirmed",
  "balance_due",
  "ready_for_service",
] as const;

/** Payment statuses from which the 0022 RPC permits approval. */
const APPROVAL_ELIGIBLE_PAYMENT_STATUSES = ["unpaid", "deposit_pending"] as const;

export const APPROVAL_SUCCESS_MSG = "Approved for deposit payment.";
export const ALREADY_APPROVED_MSG = "This reservation is already approved for deposit payment.";

/**
 * Whether the reservation detail shown to the user is eligible for the
 * "Approve for deposit payment" action.
 *
 * Mirrors the 0022 RPC's eligibility rules — does NOT recalculate the 168-hour
 * threshold. Missing approval data never enables the action.
 */
export function isApprovalEligible(reservation: ReservationDetailDTO): boolean {
  const a = reservation.approval;
  if (!a) return false;
  if (a.requiresManagementApproval !== true) return false;
  if (a.approvedAt !== null || a.approvedBy !== null) return false;
  if (!(APPROVAL_ELIGIBLE_STATUSES as readonly string[]).includes(reservation.status)) return false;
  if (
    !(APPROVAL_ELIGIBLE_PAYMENT_STATUSES as readonly string[]).includes(reservation.paymentStatus)
  )
    return false;
  if (reservation.amountPaidCents !== 0) return false;
  if (reservation.depositRequiredCents <= 0) return false;
  if (reservation.depositRequiredCents > reservation.grandTotalCents) return false;
  return true;
}

/** Whether approval was already recorded (approved_at + approved_by both set). */
export function isAlreadyApproved(reservation: ReservationDetailDTO): boolean {
  const a = reservation.approval;
  if (!a) return false;
  return a.approvedAt !== null && a.approvedBy !== null;
}

/** The default form state for the approval dialog. */
export const DEFAULT_DEADLINE_TYPE: ApprovalBalanceDeadlineType = "default";

export interface ApprovalFormState {
  balanceDeadlineType: ApprovalBalanceDeadlineType;
  customHours: string;
  customDeadline: string;
  reason: string;
}

/**
 * Build the approveReservationForPayment payload from the reservation detail
 * and the dialog form state. The timestamp is passed through verbatim —
 * never re-fetched or re-serialized. Unused optional fields are omitted.
 */
export function buildApprovalPayload(
  reservation: ReservationDetailDTO,
  form: ApprovalFormState,
): {
  reservationId: string;
  expectedUpdatedAt: string;
  balanceDeadlineType: ApprovalBalanceDeadlineType;
  customHours?: number;
  customDeadline?: string;
  reason?: string;
} {
  const payload: {
    reservationId: string;
    expectedUpdatedAt: string;
    balanceDeadlineType: ApprovalBalanceDeadlineType;
    customHours?: number;
    customDeadline?: string;
    reason?: string;
  } = {
    reservationId: reservation.id,
    expectedUpdatedAt: reservation.updatedAt,
    balanceDeadlineType: form.balanceDeadlineType,
  };

  if (form.balanceDeadlineType === "hours_before") {
    const n = Number(form.customHours);
    if (Number.isFinite(n) && n > 0) {
      payload.customHours = Math.trunc(n);
    }
  }

  if (form.balanceDeadlineType === "custom") {
    const ts = form.customDeadline.trim();
    if (ts) payload.customDeadline = ts;
  }

  if (form.balanceDeadlineType !== "default") {
    const r = form.reason.trim();
    if (r) payload.reason = r;
  }

  return payload;
}

/**
 * Safe codes that require an explicit reload before another approval attempt.
 * default_deadline_passed and invalid_deadline are NOT included — those are
 * form-level validation errors that let the user pick another deadline option.
 */
export function requiresReloadBeforeRetry(code: string): boolean {
  return (
    code === "conflict" ||
    code === "unexpected" ||
    code === "invalid_status" ||
    code === "invalid_capacity" ||
    code === "invalid_configuration" ||
    code === "checkout_requires_review" ||
    code === "not_found" ||
    code === "invalid_actor"
  );
}

/** Party display name for the approval summary. */
export function partyDisplayName(reservation: ReservationDetailDTO): string {
  const first = reservation.contactFirstName?.trim();
  const last = reservation.contactLastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return reservation.reservationNumber;
}

/** Typed result of a reload in the approval flow. */
export type ApprovalReloadResult =
  | { success: true; reservation: ReservationDetailDTO }
  | { success: false; reservation: null; error: string };

/** Assessment of a reloaded reservation for the approval flow. */
export type ApprovalReloadAssessment =
  | { kind: "approvable"; reservation: ReservationDetailDTO }
  | { kind: "already_approved"; reservation: ReservationDetailDTO }
  | { kind: "inapplicable"; reservation: ReservationDetailDTO; status: string };

/**
 * Assess a freshly reloaded reservation:
 * - "approvable": eligible for approval — show fresh detail and allow a new
 *   approval using the fresh timestamp.
 * - "already_approved": approval was recorded — show that state; do NOT mutate.
 * - "inapplicable": any other state — show current status; do NOT mutate.
 */
export function assessReloadedReservation(
  reservation: ReservationDetailDTO,
): ApprovalReloadAssessment {
  if (isAlreadyApproved(reservation)) {
    return { kind: "already_approved", reservation };
  }
  if (isApprovalEligible(reservation)) {
    return { kind: "approvable", reservation };
  }
  return { kind: "inapplicable", reservation, status: reservation.status };
}

/**
 * Success feedback label distinguishing a fresh approval from an
 * already-approved recovery (idempotent retry).
 */
export function successMessage(alreadyApproved: boolean): string {
  return alreadyApproved ? ALREADY_APPROVED_MSG : APPROVAL_SUCCESS_MSG;
}

/**
 * Status-specific message to show after a successful reload that did NOT
 * yield an approvable reservation. Returns null for approvable — the
 * gate-block UI handles that message.
 */
export function reloadOutcomeMessage(reservation: ReservationDetailDTO): string | null {
  if (isApprovalEligible(reservation)) return null;
  if (isAlreadyApproved(reservation)) return ALREADY_APPROVED_MSG;
  const label = reservation.status.replace(/_/g, " ");
  return `This reservation is now ${label}. Approval is not available.`;
}

/**
 * Endpoint response shape from getReservationDetail.
 * { ok: true; reservation } | { ok: false; error }.
 */
export type GetReservationDetailResponse =
  { ok: true; reservation: ReservationDetailDTO } | { ok: false; error?: string };

/**
 * Narrow, pure, testable reload-response discriminator. Converts the
 * getReservationDetail endpoint contract ({ ok, reservation?, error? }) into
 * the approval flow's own ApprovalReloadResult contract ({ success, ... }).
 *
 * - ok:true with a reservation → success + reservation
 * - ok:false or missing reservation → failure (no state adoption)
 * - The caller owns generation/identity guards; this helper never clears a gate
 */
export function assessReloadResponse(response: GetReservationDetailResponse): ApprovalReloadResult {
  if (response.ok && response.reservation) {
    return { success: true, reservation: response.reservation };
  }
  return {
    success: false,
    reservation: null,
    error:
      response.ok === false
        ? response.error || "Could not reload the reservation."
        : "Could not reload the reservation.",
  };
}
