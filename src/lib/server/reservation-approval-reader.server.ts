/**
 * SERVER-ONLY — read the persisted approval state from the reservations table.
 *
 * The approval columns (requires_management_approval, approved_at, approved_by,
 * approval_timing_basis, approval_submitted_at, approval_seating_start,
 * approval_timezone) were added by 0022 and live on the reservations table —
 * NOT on reservation_detail_view. This reader fetches them directly from
 * reservations using the same requested reservation ID, then validates identity
 * and version consistency before combining with the detail-view result.
 *
 * Missing/malformed fields or a failed read produce a safe detail-load failure —
 * never a default "approval not required." Timestamps are preserved verbatim.
 * The 168-hour rule is NOT recalculated from today's date; approval is NOT
 * inferred from reservation status or payment status.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReservationApprovalDetail, ApprovalTimingBasis } from "@/lib/reservation/types";

export interface ReservationApprovalReadResult {
  success: boolean;
  approval?: ReservationApprovalDetail;
  error?: string;
}

const APPROVAL_TIMING_BASES: readonly ApprovalTimingBasis[] = [
  "historical_unverified",
  "early_booking_168h_or_more",
  "late_booking_under_168h",
];

function isValidOffsetOrZTimestamp(value: string): boolean {
  if (value.length === 0) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  return /[zZ]$/.test(value) || /[+-]\d{2}:?\d{2}$/.test(value);
}

function isUuidString(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Validate an approval row from the reservations table. Returns a typed
 * ReservationApprovalDetail or null if malformed. Missing/malformed fields
 * produce null — the caller surfaces a safe detail-load failure, never a
 * default "approval not required."
 */
export function validateApprovalRow(row: unknown): ReservationApprovalDetail | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (typeof r["requires_management_approval"] !== "boolean") return null;
  const timingBasis = r["approval_timing_basis"];
  if (
    typeof timingBasis !== "string" ||
    !APPROVAL_TIMING_BASES.includes(timingBasis as ApprovalTimingBasis)
  ) {
    return null;
  }
  const approvedAt = r["approved_at"];
  const approvedBy = r["approved_by"];
  // Actor pair invariant: both null or both valid (timestamp + UUID).
  if (approvedAt === null && approvedBy === null) {
    // fine
  } else if (
    typeof approvedAt !== "string" ||
    !isValidOffsetOrZTimestamp(approvedAt) ||
    typeof approvedBy !== "string" ||
    !isUuidString(approvedBy)
  ) {
    return null;
  }
  // submittedAt / seatingStart / restaurantTimezone: null is valid for
  // historical rows; if present, timestamps must carry a timezone.
  const submittedAt = r["approval_submitted_at"];
  if (
    submittedAt !== null &&
    (typeof submittedAt !== "string" || !isValidOffsetOrZTimestamp(submittedAt))
  ) {
    return null;
  }
  const seatingStart = r["approval_seating_start"];
  if (
    seatingStart !== null &&
    (typeof seatingStart !== "string" || !isValidOffsetOrZTimestamp(seatingStart))
  ) {
    return null;
  }
  const restaurantTimezone = r["approval_timezone"];
  if (restaurantTimezone !== null && typeof restaurantTimezone !== "string") {
    return null;
  }
  return {
    requiresManagementApproval: r["requires_management_approval"],
    approvedAt: (approvedAt as string) ?? null,
    approvedBy: (approvedBy as string) ?? null,
    timingBasis: timingBasis as ApprovalTimingBasis,
    submittedAt: (submittedAt as string) ?? null,
    seatingStart: (seatingStart as string) ?? null,
    restaurantTimezone: (restaurantTimezone as string) ?? null,
  };
}

/**
 * Read the approval columns from the reservations table for the given ID.
 * Verifies that the row's id and updated_at match the expected values before
 * returning — if versions differ, returns a safe reload-required failure so
 * the caller never combines an inconsistent snapshot.
 *
 * Missing/malformed approval fields or a failed read produce a safe failure —
 * never a default "approval not required."
 */
export async function readReservationApproval(
  client: SupabaseClient,
  reservationId: string,
  expectedUpdatedAt: string,
): Promise<ReservationApprovalReadResult> {
  const { data, error } = await client
    .from("reservations")
    .select(
      "id,updated_at,requires_management_approval,approved_at,approved_by,approval_timing_basis,approval_submitted_at,approval_seating_start,approval_timezone",
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (error) {
    return {
      success: false,
      error: "Reservation detail could not be loaded.",
    };
  }
  if (!data) {
    return {
      success: false,
      error: "Reservation detail could not be loaded.",
    };
  }

  const row = data as Record<string, unknown>;

  // Identity check: the row must match the requested reservation.
  if (typeof row["id"] !== "string" || row["id"] !== reservationId) {
    return {
      success: false,
      error: "Reservation detail could not be loaded.",
    };
  }

  // Version consistency: updated_at must match the detail-view's updated_at.
  // If versions differ, return a reload-required failure rather than combining
  // an inconsistent snapshot.
  if (typeof row["updated_at"] !== "string" || row["updated_at"] !== expectedUpdatedAt) {
    return {
      success: false,
      error: "This reservation has changed. Reload it and try again.",
    };
  }

  const approval = validateApprovalRow(row);
  if (!approval) {
    return {
      success: false,
      error: "Reservation detail could not be loaded.",
    };
  }

  return { success: true, approval };
}
