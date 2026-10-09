/**
 * Sundays & Seating — DTOs and operation inputs.
 *
 * Independent of the Menu CMS and booking engine. Client-safe.
 * Sunday services and seating times are internal configuration; no public
 * availability promise is made until capacity enforcement is implemented.
 */
import type { SundayStatus, TableSize, BalanceDeadlineType } from "./constants";
import type { SpaceType } from "@/lib/spaces/constants";

export interface SundayServiceDTO {
  id: string;
  /** ISO date (YYYY-MM-DD) of the Sunday service. */
  date: string;
  label: string;
  status: SundayStatus;
  /** Venue space hosting this service. */
  spaceId: string;
  /** Staff-configured online booking limit for this service (separate from reported capacity). */
  onlineBookingLimit: number | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CreateSundayServiceInput {
  date: string;
  label?: string;
  status?: SundayStatus;
  spaceId: string;
  onlineBookingLimit?: number | null;
  isActive?: boolean;
  displayOrder?: number;
}

export interface UpdateSundayServiceInput {
  id: string;
  expectedUpdatedAt: string;
  date?: string;
  label?: string;
  status?: SundayStatus;
  spaceId?: string;
  onlineBookingLimit?: number | null;
  isActive?: boolean;
  displayOrder?: number;
}

export interface SundayServiceOperationResult {
  success: boolean;
  data?: SundayServiceDTO;
  error?: string;
  conflict?: boolean;
}

export interface SeatingTimeDTO {
  id: string;
  sundayServiceId: string;
  label: string;
  /** Start time in HH:MM (24h), within the service window. */
  startTime: string;
  /** End time in HH:MM (24h). */
  endTime: string;
  /** Staff-configured booking limit for this seating (separate from space capacity). */
  onlineBookingLimit: number | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CreateSeatingTimeInput {
  sundayServiceId: string;
  label: string;
  startTime: string;
  endTime: string;
  onlineBookingLimit?: number | null;
  isActive?: boolean;
  displayOrder?: number;
}

export interface UpdateSeatingTimeInput {
  id: string;
  expectedUpdatedAt: string;
  label?: string;
  startTime?: string;
  endTime?: string;
  onlineBookingLimit?: number | null;
  isActive?: boolean;
  displayOrder?: number;
}

export interface SeatingTimeOperationResult {
  success: boolean;
  data?: SeatingTimeDTO;
  error?: string;
  conflict?: boolean;
}

export interface DiningTableDTO {
  id: string;
  spaceId: string;
  label: string;
  seats: TableSize;
  zone: string;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDiningTableInput {
  spaceId: string;
  label: string;
  seats: TableSize;
  zone?: string;
  isActive?: boolean;
  displayOrder?: number;
}

export interface UpdateDiningTableInput {
  id: string;
  expectedUpdatedAt: string;
  label?: string;
  seats?: TableSize;
  zone?: string;
  isActive?: boolean;
  displayOrder?: number;
}

export interface DiningTableOperationResult {
  success: boolean;
  data?: DiningTableDTO;
  error?: string;
  conflict?: boolean;
}

/**
 * Result of listing dining tables. A discriminated union so that authorization
 * failure, invalid input, and repository failure are never indistinguishable
 * from a successful empty inventory.
 */
export type DiningTableListResult =
  { ok: true; tables: DiningTableDTO[] } | { ok: false; error: string };

/**
 * Minimal room projection for the Tables screen. Only the fields needed to
 * label and filter physical tables — no booking limits, audit actors, or
 * other venue configuration. Inactive rooms are included so existing tables
 * can still display their room names.
 */
export interface DiningTableRoomOption {
  id: string;
  name: string;
  spaceType: SpaceType;
  isActive: boolean;
}

/**
 * Result of listing room options for the Tables screen. A discriminated union
 * so authorization failure and repository failure are never indistinguishable
 * from a successful empty list.
 */
export type DiningTableRoomOptionsResult =
  { ok: true; rooms: DiningTableRoomOption[] } | { ok: false; error: string };

/** Payment policy configuration (singleton). */
export interface PaymentPolicyDTO {
  /** Deposit percentage at reservation (confirmed 50). */
  depositPercent: number;
  /** Default balance deadline: hours before the seating (confirmed 72). */
  defaultBalanceDeadlineHours: number;
  /** Restaurant timezone (IANA, e.g. America/Chicago). Required for scheduling. */
  restaurantTimezone: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface UpdatePaymentPolicyInput {
  expectedUpdatedAt: string;
  depositPercent: number;
  defaultBalanceDeadlineHours: number;
  restaurantTimezone: string | null;
}

export interface PaymentPolicyOperationResult {
  success: boolean;
  data?: PaymentPolicyDTO;
  error?: string;
  conflict?: boolean;
}

/** Per-reservation balance deadline override (audited). Future phase. */
export interface ReservationBalanceOverride {
  reservationId: string;
  deadlineType: BalanceDeadlineType;
  /** Hours before seating, when deadlineType is "hours_before" or "custom". */
  customHours: number | null;
  /** Staff user who made the override. */
  changedBy: string;
  reason: string;
  changedAt: string;
}

/* ----------------------------- Table assignments ----------------------------- */

/**
 * Safe machine-readable codes returned by the assign_reservation_tables_atomic
 * RPC. The application wrapper maps these to user-facing messages.
 */
export type AssignTablesCode =
  | "conflict"
  | "table_conflict"
  | "insufficient_seats"
  | "invalid_table"
  | "invalid_configuration"
  | "invalid_status"
  | "not_found"
  | "invalid_data"
  | "invalid_actor"
  | "unexpected";

/**
 * Result of assigning (or releasing) a reservation's physical tables.
 *
 * Success carries the reservation ID, the assigned table IDs (empty when all
 * tables were released), and the new reservation updatedAt for the next edit.
 * Failure carries a safe code + message. Raw database errors are never exposed.
 */
export type AssignTablesResult =
  | {
      ok: true;
      reservationId: string;
      assignedTableIds: string[];
      reservationUpdatedAt: string;
    }
  | {
      ok: false;
      code: AssignTablesCode;
      error: string;
    };

/* --------------------- Reservation table-assignment context --------------------- */

/**
 * A current (released_at IS NULL) table assignment for a reservation.
 * Inactive currently-assigned tables remain visible so they can be released.
 */
export interface ReservationTableAssignmentDTO {
  id: string;
  diningTableId: string;
  seatingStart: string;
  seatingEnd: string;
  tableLabel: string;
  tableSeats: number;
  tableIsActive: boolean;
}

/**
 * A physical table in the reservation's room. Named roomTables (not
 * availableTables): this endpoint does NOT guarantee a table is free — the
 * assignment RPC checks conflicts authoritatively when saving.
 */
export interface ReservationRoomTableDTO {
  id: string;
  label: string;
  seats: number;
  zone: string;
  isActive: boolean;
}

/**
 * Context for the party-to-table assignment dialog. Only the fields needed
 * to present the reservation, its current assignments, and the room's
 * physical tables. No other parties' contact info, dietary notes, payments,
 * or order contents.
 */
export interface ReservationTableContextDTO {
  reservationId: string;
  reservationNumber: string;
  partySize: number;
  status: string;
  updatedAt: string;
  roomId: string;
  roomName: string;
  serviceDate: string;
  seatingStart: string;
  seatingEnd: string;
  currentAssignments: ReservationTableAssignmentDTO[];
  roomTables: ReservationRoomTableDTO[];
}

export type ReservationTableContextResult =
  { ok: true; context: ReservationTableContextDTO } | { ok: false; error: string };

/* ----------------------------- Reservation confirmation ----------------------------- */

/**
 * Safe machine-readable codes returned by the confirm_reservation_atomic RPC.
 * The application wrapper maps these to user-facing messages.
 */
export type ConfirmReservationCode =
  "conflict" | "invalid_status" | "not_found" | "invalid_data" | "invalid_actor" | "unexpected";

/**
 * Result of confirming a reservation (pending_review → confirmed).
 *
 * Success carries the reservation ID, the new reservation updatedAt, and
 * whether the reservation was already confirmed (idempotent recovery).
 * Failure carries a safe code + message. Raw database errors are never exposed.
 *
 * Confirmation accepts the reservation request; it does NOT collect money,
 * satisfy the deposit, or change payment status. The wrapper must not claim
 * otherwise.
 */
export type ConfirmReservationResult =
  | {
      ok: true;
      reservationId: string;
      reservationUpdatedAt: string;
      alreadyConfirmed: boolean;
    }
  | {
      ok: false;
      code: ConfirmReservationCode;
      error: string;
    };

/* ----------------------------- Reservation cancellation ----------------------------- */

/**
 * Safe machine-readable codes returned by the cancel_reservation_atomic RPC.
 * The application wrapper maps these to user-facing messages.
 */
export type CancelReservationCode =
  "conflict" | "invalid_status" | "not_found" | "invalid_data" | "invalid_actor" | "unexpected";

/**
 * Result of cancelling a reservation (pre-arrival).
 *
 * Success carries the reservation ID, the new reservation updatedAt, and
 * whether the reservation was already cancelled (idempotent recovery).
 * Failure carries a safe code + message. Raw database errors are never exposed.
 *
 * Cancellation does NOT refund money or change payment status. The wrapper
 * must not claim otherwise.
 */
export type CancelReservationResult =
  | {
      ok: true;
      reservationId: string;
      reservationUpdatedAt: string;
      alreadyCancelled: boolean;
    }
  | {
      ok: false;
      code: CancelReservationCode;
      error: string;
    };
