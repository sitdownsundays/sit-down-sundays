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
  /** Client-computed preview result for review-required detection. */
  clientPreviewSubtotalCents?: number;
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
  depositRequiredCents: number;
  grandTotalCents: number;
  remainingBalanceCents: number;
  balanceDeadline: string | null;
  hasUnresolvedRules: boolean;
  unresolvedNotes: string[];
  /** True when config changed since the client preview and review is required. */
  reviewRequired?: boolean;
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
  | "unresolved_pricing";

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
  error?: string;
  /** Validation/authorization field errors. */
  fieldErrors?: Record<string, string>;
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
