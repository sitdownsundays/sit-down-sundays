/**
 * SERVER-ONLY — adapt a ReservationDetailDTO (with Record<string, unknown>
 * snapshots from the repository) into a JSON-safe ReservationDetailTransport
 * for the getReservationDetail server-function boundary.
 *
 * `Record<string, unknown>` is not serializable across the server-function RPC
 * boundary. This adapter validates that the stored snapshot content is genuine
 * JSON (primitives, null, arrays, nested objects) and copies it into a
 * JsonObject-typed transport DTO. Malformed stored content — not a plain
 * object, or a descendant that holds a non-JSON value (function, undefined,
 * symbol, class instance) — produces a safe detail-load failure rather than
 * silently replacing the snapshot with `{}` or shipping non-JSON data to the
 * browser.
 */
import type {
  ReservationDetailDTO,
  ReservationDetailTransport,
  JsonObject,
  JsonValue,
  ApprovalTimingBasis,
} from "@/lib/reservation/types";

/**
 * Recursively validate that `value` is JSON-safe (string | number | boolean |
 * null | JsonValue[] | JsonObject). Returns the narrowed value, or `null` if
 * the value contains any non-JSON type (function, undefined, symbol, bigint,
 * or an object that is not a plain record/array).
 *
 * A plain object whose own entries are all JSON-safe is accepted; a class
 * instance, Map, Set, Date, etc. is rejected (those are not serializable).
 */
function asJsonValue(value: unknown): JsonValue | null {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      // NaN / Infinity are not representable in JSON; reject them.
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "object": {
      if (value === null) return null;
      if (Array.isArray(value)) {
        const out: JsonValue[] = [];
        for (const el of value) {
          const elJson = asJsonValue(el);
          if (elJson === null && el !== null) return null; // non-JSON element
          out.push(elJson as JsonValue);
        }
        return out;
      }
      // Reject class instances, Map, Set, Date, etc. — only plain records.
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      ) {
        return null;
      }
      const obj: JsonObject = {};
      for (const [k, v] of Object.entries(value)) {
        const vJson = asJsonValue(v);
        if (vJson === null && v !== null) return null; // non-JSON entry value
        obj[k] = vJson as JsonValue;
      }
      return obj;
    }
    default:
      // function, symbol, bigint, undefined
      return null;
  }
}

/**
 * Validate that `value` is a JSON-safe object (JsonObject). Returns the object
 * or `null` if it is not a plain object or contains any non-JSON descendant.
 */
export function asJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const validated = asJsonValue(value);
  if (validated === null || typeof validated !== "object" || Array.isArray(validated)) {
    return null;
  }
  return validated;
}

export interface ReservationDetailTransportResult {
  success: boolean;
  reservation?: ReservationDetailTransport;
  error?: string;
}

const APPROVAL_TIMING_BASES: readonly ApprovalTimingBasis[] = [
  "historical_unverified",
  "early_booking_168h_or_more",
  "late_booking_under_168h",
];

/**
 * Validate the approval object from a ReservationDetailDTO. The approval
 * fields are plain JSON-safe values (booleans, strings, null) — no snapshot
 * recursion is needed — but we still verify types, the actor pair invariant
 * (both null or both present), timestamp timezone-bearing format, and the
 * recognized timing basis.
 *
 * Returns null if malformed — the caller surfaces a safe detail-load failure
 * rather than a defaulted "approval not required."
 */
function validateApproval(approval: unknown): ReservationDetailDTO["approval"] | null {
  if (typeof approval !== "object" || approval === null || Array.isArray(approval)) {
    return null;
  }
  const a = approval as Record<string, unknown>;
  if (typeof a["requiresManagementApproval"] !== "boolean") return null;
  if (
    typeof a["timingBasis"] !== "string" ||
    !APPROVAL_TIMING_BASES.includes(a["timingBasis"] as ApprovalTimingBasis)
  ) {
    return null;
  }
  const approvedAt = a["approvedAt"];
  const approvedBy = a["approvedBy"];
  // Actor pair invariant: both null or both a valid timestamp/UUID.
  if (approvedAt === null && approvedBy === null) {
    // both null — fine
  } else if (
    typeof approvedAt !== "string" ||
    !isValidOffsetOrZTimestampStr(approvedAt) ||
    typeof approvedBy !== "string" ||
    !isUuid(approvedBy)
  ) {
    return null;
  }
  // Submitted-at / seating-start / restaurant-timezone: null is valid for
  // historical rows; if present, timestamps must carry a timezone.
  const submittedAt = a["submittedAt"];
  if (submittedAt !== null) {
    if (typeof submittedAt !== "string" || !isValidOffsetOrZTimestampStr(submittedAt)) {
      return null;
    }
  }
  const seatingStart = a["seatingStart"];
  if (seatingStart !== null) {
    if (typeof seatingStart !== "string" || !isValidOffsetOrZTimestampStr(seatingStart)) {
      return null;
    }
  }
  const restaurantTimezone = a["restaurantTimezone"];
  if (restaurantTimezone !== null) {
    if (typeof restaurantTimezone !== "string") return null;
  }
  return {
    requiresManagementApproval: a["requiresManagementApproval"],
    approvedAt: approvedAt as string | null,
    approvedBy: approvedBy as string | null,
    timingBasis: a["timingBasis"] as ApprovalTimingBasis,
    submittedAt: submittedAt as string | null,
    seatingStart: seatingStart as string | null,
    restaurantTimezone: restaurantTimezone as string | null,
  };
}

function isValidOffsetOrZTimestampStr(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  return /[zZ]$/.test(value) || /[+-]\d{2}:?\d{2}$/.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Convert a repository ReservationDetailDTO into a JSON-safe transport DTO.
 * Validates both pricingSnapshot and policySnapshot as genuine JSON. Invalid
 * stored content yields a safe failure — never an empty-object fallback and
 * never an un-serializable value across the RPC boundary.
 *
 * The approval object is validated structurally (types, actor pair, timezone-
 * bearing timestamps, recognized timing basis). Missing/malformed approval
 * yields a safe failure, never a default "approval not required."
 *
 * All non-snapshot fields (identity, monetary values, guest notes, timestamps)
 * are copied through unchanged.
 */
export function toReservationDetailTransport(
  detail: ReservationDetailDTO,
): ReservationDetailTransportResult {
  const pricingSnapshot = asJsonObject(detail.pricingSnapshot);
  if (!pricingSnapshot) {
    return {
      success: false,
      error: "Reservation detail could not be loaded.",
    };
  }
  const policySnapshot = asJsonObject(detail.policySnapshot);
  if (!policySnapshot) {
    return {
      success: false,
      error: "Reservation detail could not be loaded.",
    };
  }
  const approval = validateApproval(detail.approval);
  if (!approval) {
    return {
      success: false,
      error: "Reservation detail could not be loaded.",
    };
  }
  const { pricingSnapshot: _ps, policySnapshot: _ps2, approval: _ap, ...rest } = detail;
  return {
    success: true,
    reservation: { ...rest, pricingSnapshot, policySnapshot, approval },
  };
}
