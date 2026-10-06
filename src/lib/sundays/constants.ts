/**
 * Sundays & Seating — constants and enums.
 *
 * Centralized so the UI and server validation share one vocabulary.
 */
export const SUNDAY_STATUS_LABELS = {
  scheduled: "Scheduled",
  open: "Open",
  sold_out: "Sold out",
  closed: "Closed",
} as const;

export type SundayStatus = keyof typeof SUNDAY_STATUS_LABELS;

export const SUNDAY_STATUSES: SundayStatus[] = ["scheduled", "open", "sold_out", "closed"];

export const TABLE_SIZE_LABELS = {
  4: "Seats 4",
  6: "Seats 6",
  8: "Seats 8",
  10: "Seats 10",
  12: "Seats 12",
} as const;

export type TableSize = keyof typeof TABLE_SIZE_LABELS;

export const TABLE_SIZES: TableSize[] = [4, 6, 8, 10, 12];

/** Service window defaults (confirmed by owner). */
export const SERVICE_WINDOW_START = "12:00"; // noon
export const SERVICE_WINDOW_END = "19:00"; // 7 PM
export const DINING_DURATION_HOURS = 2.5;
/** Latest permitted reservation start (4:30 PM). */
export const LATEST_RESERVATION_START = "16:30";

export const BALANCE_DEADLINE_TYPE_LABELS = {
  default: "Use default (72 hours before)",
  hours_before: "Custom hours before seating",
  at_check_in: "Pay at check-in",
} as const;

export type BalanceDeadlineType = keyof typeof BALANCE_DEADLINE_TYPE_LABELS;

/** Confirmed payment defaults. */
export const DEFAULT_DEPOSIT_PERCENT = 50;
export const DEFAULT_BALANCE_DEADLINE_HOURS = 72;
