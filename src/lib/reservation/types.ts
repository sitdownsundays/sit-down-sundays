/**
 * Reservation model — DTOs and operation inputs.
 *
 * Framework-independent, client-safe. No server-only imports, no mock data.
 *
 * A reservation is a REQUEST, not a guaranteed booking. The initial status is
 * pending_review and payment status unpaid. Staff confirm later. Snapshots are
 * immutable at submission so later config changes never retroactively alter a
 * booking. Reservation numbers are NOT authorization tokens.
 */
import type { GuestCategory } from "@/lib/ordering/constants";
import type { SelectionCategory } from "@/lib/ordering/constants";

/** Reservation lifecycle status (subset of the domain RESERVATION_STATUSES). */
export type ReservationStatus =
  | "pending_review"
  | "confirmed"
  | "balance_due"
  | "paid_in_full"
  | "ready_for_service"
  | "checked_in"
  | "seated"
  | "completed"
  | "transfer_requested"
  | "cancellation_requested"
  | "cancelled"
  | "no_show"
  | "refund_review";

export type ReservationPaymentStatus =
  | "unpaid"
  | "deposit_pending"
  | "deposit_paid"
  | "partially_paid"
  | "balance_due"
  | "paid_in_full"
  | "partially_refunded"
  | "refunded"
  | "payment_failed"
  | "disputed";

export type ReservationExperienceType = "standard" | "private_room";

/** A single guest's meal allocation within a reservation. */
export interface ReservationGuestInput {
  guestIndex: number;
  category: GuestCategory;
  /** Optional name; "Guest 1" etc. is fine for the MVP. */
  name?: string;
  packageId: string;
  /** Included meat/side/bread selections covered by the package price. */
  included: Array<{
    menuItemId: string;
    selectionCategory: SelectionCategory;
  }>;
  /** Individual add-ons attached to this guest. */
  addons: Array<{ addonId: string; quantity: number }>;
  /** Per-guest food allergies (max 1,000 chars). Optional for backward compat. */
  foodAllergies?: string;
  /** Per-guest dietary preferences/restrictions (max 1,000 chars). Optional for backward compat. */
  dietaryPreferences?: string;
  /** Per-guest meal-specific requests (max 1,000 chars). Optional for backward compat. */
  mealRequests?: string;
}

/** A shared platter line belonging to the party (priced per platter). */
export interface ReservationPlatterInput {
  platterId: string;
  quantity: number;
}

/** Full submission payload for a reservation request. */
export interface SubmitReservationRequestInput {
  sundayServiceId: string;
  seatingTimeId: string;
  experienceType: ReservationExperienceType;
  partySize: number;
  adults: number;
  seniors: number;
  children: number;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  guestNotes?: string;
  dietaryNotes?: string;
  accessibilityRequests?: string;
  occasion?: string;
  guests: ReservationGuestInput[];
  platters: ReservationPlatterInput[];
  /** Idempotency key supplied by the client. */
  idempotencyKey: string;
  /** Client-computed preview subtotal for review-required detection (legacy). */
  clientPreviewSubtotalCents?: number;
  /**
   * Full reviewed-price snapshot the customer saw at quote time. When present,
   * the server compares every financial term (subtotal, gratuity, tax, grand
   * total, deposit, and applied policy rates/taxability/deposit%) against the
   * authoritative recalculation. If ANY term changed, reviewRequired is set so
   * the customer must re-review before persistence. Legacy submissions omitting
   * this field fall back to the subtotal-only comparison for hash compatibility.
   */
  clientPreviewPrice?: ReviewedPrice;
}

/**
 * A typed snapshot of the reviewed price terms shown to the customer at quote
 * time. Carried through the quote → wizard → submission → server comparison so
 * a change to ANY term forces a fresh review.
 */
export interface ReviewedPrice {
  subtotalCents: number;
  gratuityCents: number;
  taxCents: number;
  grandTotalCents: number;
  depositRequiredCents: number;
  appliedGratuityRateBasisPoints: number;
  appliedTaxRateBasisPoints: number;
  appliedTaxOnGratuity: boolean;
  appliedDepositPercent: number;
}

/** Public-facing availability option (sanitized — no contact details). */
export interface PublicAvailabilityOption {
  sundayService: {
    id: string;
    date: string;
    label: string;
  };
  seatingTime: {
    id: string;
    label: string;
    startTime: string;
    endTime: string;
  };
  spaceName: string;
  /**
   * Staff-configured REQUEST CEILING for this seating (the seating's
   * onlineBookingLimit). This is NOT measured live inventory or remaining
   * capacity — real-time remaining capacity is a future phase.
   */
  configuredRequestCeiling: number;
  /**
   * Configured restaurant IANA timezone for the service date. Used to display
   * service dates and seating times in the restaurant's wall-clock time —
   * never the browser or server host timezone.
   */
  restaurantTimezone: string;
}

/** Returned order line from the authoritative server pricing path. */
export interface ReservationPriceLine {
  label: string;
  amountCents: number;
  kind: string;
}

/** Result of a server-authoritative pricing recalculation at submission. */
export interface ReservationPricingResult {
  success: boolean;
  lines: ReservationPriceLine[];
  subtotalCents: number;
  /** Mandatory gratuity in integer cents (0 when rate is 0). */
  gratuityCents?: number;
  /** Sales tax in integer cents (0 when rate is 0). */
  taxCents?: number;
  depositRequiredCents: number;
  grandTotalCents: number;
  remainingBalanceCents: number;
  /**
   * Projected balance AFTER the required deposit is paid (grandTotal − deposit).
   * This is a PROJECTION, not the actual outstanding balance. The actual
   * outstanding balance before any payment is `remainingBalanceCents` (the full
   * grand total). Nothing is marked paid by computing this projection.
   */
  projectedBalanceAfterDepositCents?: number;
  balanceDeadline: string | null;
  hasUnresolvedRules: boolean;
  unresolvedNotes: string[];
  /** True when config changed since the client preview and review is required. */
  reviewRequired?: boolean;
  /**
   * The authoritative reviewed-price snapshot for the client to carry through
   * to submission. The server compares this against a fresh recalculation at
   * submission time; a mismatch sets reviewRequired so the customer must
   * re-review before persistence.
   */
  reviewedPrice?: ReviewedPrice;
  /** Snapshot of the itemized order for persistence. */
  pricingSnapshot: Record<string, unknown>;
  /** Snapshot of the agreed payment terms for persistence. */
  policySnapshot: Record<string, unknown>;
  error?: string;
}

/**
 * Outcome classification for a submission result.
 *
 *  - "confirmed_success": the server saved (or replayed) the request.
 *  - "proven_rejection": the server DEFINITIVELY did not save anything — a
 *    validation failure, idempotency-key mismatch, or a proven no-write
 *    rollback. Editing and a new key are safe.
 *  - "uncertain": the persistence outcome is unknown (generic infrastructure
 *    failure, RPC communication error, unclassified code). The request MAY be
 *    saved server-side. Edit/Back and a new key are NOT safe — only a same-key
 *    exact-payload retry may recover the original result.
 *
 * The controller classifies by this field, NOT by matching human-readable
 * error strings. Proven rejections carry a stable `rejectionCode`; everything
 * else with `success:false` and no `rejectionCode` is conservatively uncertain.
 */
export type SubmissionOutcome = "confirmed_success" | "proven_rejection" | "uncertain";

/** Stable codes for proven (no-write) rejections. */
export type RejectionCode =
  | "idempotency_key_mismatch"
  | "invalid_service"
  | "invalid_seating"
  | "invalid_reference"
  | "invalid_data"
  | "validation_failed"
  | "eligibility_failed"
  | "pricing_failed"
  | "review_required"
  | "unresolved_pricing"
  | "capacity_not_ready"
  | "capacity_unavailable"
  | "invalid_configuration";

/** Submit result. */
export interface SubmitReservationResult {
  success: boolean;
  /**
   * Outcome classification. Set by the repository/submit path so the client
   * controller can distinguish a proven no-write rejection from an uncertain
   * infrastructure failure WITHOUT parsing error strings.
   */
  outcome?: SubmissionOutcome;
  /** Stable code present only on a proven rejection (outcome "proven_rejection"). */
  rejectionCode?: RejectionCode;
  reservationId?: string;
  reservationNumber?: string;
  status?: ReservationStatus;
  paymentStatus?: ReservationPaymentStatus;
  /** True when the same idempotency key + payload returned the existing reservation. */
  idempotentReplay?: boolean;
  /**
   * Capacity-hold metadata from the capacity-backed submission RPC. A
   * historical replay may legitimately lack these — never fabricate a hold or
   * deadline. The hold deadline is the server-generated two-hour window, NOT
   * money received or a paid deposit.
   */
  holdId?: string;
  holdDeadline?: string;
  /** Capacity-hold lifecycle state from the RPC (e.g. "held", "allocated"). */
  capacityState?: string;
  error?: string;
  /** Validation/authorization field errors. */
  fieldErrors?: Record<string, string>;
}

/**
 * Approval timing basis derived by 0022's set_approval_requirement_0022
 * trigger at insert time. Stored on the reservations row.
 */
export type ApprovalTimingBasis =
  "historical_unverified" | "early_booking_168h_or_more" | "late_booking_under_168h";

/**
 * Persisted approval state exposed through the authorized reservation-detail
 * read path. Derived from the actual reservations columns added by 0022 —
 * never inferred from reservation status, payment status, or today's date.
 */
export interface ReservationApprovalDetail {
  /** Whether the 168-hour late-booking rule flagged this request for review. */
  requiresManagementApproval: boolean;
  /** Timestamp of a verified management approval, or null if not yet approved. */
  approvedAt: string | null;
  /** UUID of the approving actor, or null if not yet approved. */
  approvedBy: string | null;
  /** Server-derived timing classification set at submission. */
  timingBasis: ApprovalTimingBasis;
  /** Submission time used to compute the 168-hour rule, or null for historical rows. */
  submittedAt: string | null;
  /** Seating start used to compute the 168-hour rule, or null for historical rows. */
  seatingStart: string | null;
  /** Restaurant timezone used for the timing calculation, or null for historical rows. */
  restaurantTimezone: string | null;
}

/** Reservation detail for staff/admin. */
export interface ReservationDetailDTO {
  id: string;
  reservationNumber: string;
  status: ReservationStatus;
  paymentStatus: ReservationPaymentStatus;
  experienceType: ReservationExperienceType;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  sundayServiceId: string;
  seatingTimeId: string;
  spaceName: string;
  serviceDate: string;
  seatingStartTime: string;
  seatingEndTime: string;
  partySize: number;
  adults: number;
  seniors: number;
  children: number;
  guestNotes: string;
  dietaryNotes: string;
  accessibilityRequests: string;
  occasion: string;
  internalNotes: string;
  subtotalCents: number;
  depositRequiredCents: number;
  grandTotalCents: number;
  amountPaidCents: number;
  remainingBalanceCents: number;
  balanceDeadline: string | null;
  /** Persisted approval state from the 0022 columns. */
  approval: ReservationApprovalDetail;
  pricingSnapshot: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  guests: Array<{
    id: string;
    guestIndex: number;
    guestCategory: GuestCategory;
    guestName: string | null;
    packageId: string;
    packageNameSnapshot: string;
    packagePriceSnapshot: number;
    includedSelections: Array<{
      menuItemId: string;
      selectionCategory: SelectionCategory;
      name: string;
    }>;
    addons: Array<{
      id: string;
      addonId: string;
      addonNameSnapshot: string;
      pricePerUnitSnapshot: number;
      quantity: number;
    }>;
    foodAllergies: string;
    dietaryPreferences: string;
    mealRequests: string;
  }>;
  platters: Array<{
    id: string;
    platterId: string;
    platterNameSnapshot: string;
    pricePerPlatterSnapshot: number;
    quantity: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * JSON-safe primitive tree for transport across the server-function boundary.
 * `Record<string, unknown>` is not serializable; `JsonObject` is.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

/**
 * Transport DTO for getReservationDetail. Structurally identical to
 * ReservationDetailDTO except the two snapshot fields are typed as JsonObject
 * (JSON-safe) instead of Record<string, unknown> (not serializable).
 * Assignable to ReservationDetailDTO, so existing consumers are unaffected.
 */
export type ReservationDetailTransport = Omit<
  ReservationDetailDTO,
  "pricingSnapshot" | "policySnapshot"
> & {
  pricingSnapshot: JsonObject;
  policySnapshot: JsonObject;
};

/** List item for the admin reservation table. */
export interface ReservationListItemDTO {
  id: string;
  reservationNumber: string;
  status: ReservationStatus;
  paymentStatus: ReservationPaymentStatus;
  contactName: string;
  partySize: number;
  serviceDate: string;
  seatingStartTime: string;
  remainingBalanceCents: number;
  createdAt: string;
}

export interface ListReservationsResult {
  success: boolean;
  reservations: ReservationListItemDTO[];
  error?: string;
}

export interface GetReservationResult {
  success: boolean;
  reservation?: ReservationDetailDTO;
  error?: string;
}
