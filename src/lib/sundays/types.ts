/**
 * Sundays & Seating — DTOs and operation inputs.
 *
 * Independent of the Menu CMS and booking engine. Client-safe.
 * Sunday services and seating times are internal configuration; no public
 * availability promise is made until capacity enforcement is implemented.
 */
import type { SundayStatus, TableSize, BalanceDeadlineType } from "./constants";

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
