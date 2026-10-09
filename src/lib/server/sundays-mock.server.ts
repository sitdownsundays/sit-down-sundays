/**
 * SERVER-ONLY — Mock Sundays & Seating repository.
 *
 * Local development only. Never used in production (env.server rejects mock
 * mode in production). Behaves predictably for development without pretending
 * to be persistent production data.
 *
 * Enforces the same validation rules as the Supabase repository and the
 * database CHECK constraints: service window (noon–7 PM), dining duration
 * 2.5h, latest reservation start 4:30 PM, seating times within the service
 * window, optimistic-concurrency conflicts, and the payment-policy singleton.
 */
import type {
  SundayServiceDTO,
  SeatingTimeDTO,
  PaymentPolicyDTO,
  CreateSundayServiceInput,
  UpdateSundayServiceInput,
  CreateSeatingTimeInput,
  UpdateSeatingTimeInput,
  UpdatePaymentPolicyInput,
  SundayServiceOperationResult,
  SeatingTimeOperationResult,
  PaymentPolicyOperationResult,
  DiningTableDTO,
  CreateDiningTableInput,
  UpdateDiningTableInput,
  DiningTableOperationResult,
} from "@/lib/sundays/types";
import type { ISundaysRepository } from "./sundays-repository-interface.server";
import type { SundayStatus, TableSize } from "@/lib/sundays/constants";
import {
  SERVICE_WINDOW_START,
  SERVICE_WINDOW_END,
  LATEST_RESERVATION_START,
  DEFAULT_DEPOSIT_PERCENT,
  DEFAULT_BALANCE_DEADLINE_HOURS,
} from "@/lib/sundays/constants";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

/** minutes since midnight for an HH:MM string */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const WINDOW_START_MIN = toMinutes(SERVICE_WINDOW_START);
const WINDOW_END_MIN = toMinutes(SERVICE_WINDOW_END);
const LATEST_START_MIN = toMinutes(LATEST_RESERVATION_START);

/** Validate a seating time against the confirmed service window. */
function validateSeatingWindow(startTime: string, endTime: string): string | null {
  if (!timeRegex.test(startTime)) return "Start time must use HH:MM (24-hour).";
  if (!timeRegex.test(endTime)) return "End time must use HH:MM (24-hour).";
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start < WINDOW_START_MIN) return `Seating must start at or after ${SERVICE_WINDOW_START}.`;
  if (start > LATEST_START_MIN)
    return `Latest permitted reservation start is ${LATEST_RESERVATION_START}.`;
  if (end <= start) return "End time must be later than start time.";
  if (end > WINDOW_END_MIN) return `Service ends at ${SERVICE_WINDOW_END}.`;
  return null;
}

export class MockSundaysRepository implements ISundaysRepository {
  private services: SundayServiceDTO[] = [];
  private seatingTimes: SeatingTimeDTO[] = [];
  private paymentPolicy: PaymentPolicyDTO = {
    depositPercent: DEFAULT_DEPOSIT_PERCENT,
    defaultBalanceDeadlineHours: DEFAULT_BALANCE_DEADLINE_HOURS,
    restaurantTimezone: null,
    updatedAt: new Date().toISOString(),
  };

  async listAllSundayServices(): Promise<SundayServiceDTO[]> {
    return [...this.services].sort(
      (a, b) => a.displayOrder - b.displayOrder || a.date.localeCompare(b.date),
    );
  }

  async getSundayService(id: string): Promise<SundayServiceDTO | null> {
    return this.services.find((s) => s.id === id) ?? null;
  }

  async createSundayService(
    actorUserId: string,
    input: CreateSundayServiceInput,
  ): Promise<SundayServiceOperationResult> {
    if (!dateRegex.test(input.date)) {
      return { success: false, error: "Use a valid date (YYYY-MM-DD)." };
    }
    const now = new Date().toISOString();
    const newService: SundayServiceDTO = {
      id: crypto.randomUUID(),
      date: input.date,
      label: input.label ?? "",
      status: (input.status ?? "scheduled") as SundayStatus,
      spaceId: input.spaceId,
      onlineBookingLimit: input.onlineBookingLimit ?? null,
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    };
    this.services.push(newService);
    return { success: true, data: { ...newService } };
  }

  async updateSundayService(
    actorUserId: string,
    input: UpdateSundayServiceInput,
  ): Promise<SundayServiceOperationResult> {
    const idx = this.services.findIndex((s) => s.id === input.id);
    if (idx === -1) return { success: false, error: "Sunday service not found." };
    const existing = this.services[idx];
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This Sunday service was modified by another user. Please reload the latest data.",
      };
    }
    if (input.date !== undefined && !dateRegex.test(input.date)) {
      return { success: false, error: "Use a valid date (YYYY-MM-DD)." };
    }
    const updated: SundayServiceDTO = {
      ...existing,
      date: input.date ?? existing.date,
      label: input.label ?? existing.label,
      status: input.status ?? existing.status,
      spaceId: input.spaceId ?? existing.spaceId,
      onlineBookingLimit:
        input.onlineBookingLimit !== undefined
          ? input.onlineBookingLimit
          : existing.onlineBookingLimit,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      displayOrder: input.displayOrder !== undefined ? input.displayOrder : existing.displayOrder,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUserId,
    };
    this.services[idx] = updated;
    return { success: true, data: { ...updated } };
  }

  async listSeatingTimesForService(sundayServiceId: string): Promise<SeatingTimeDTO[]> {
    return this.seatingTimes
      .filter((s) => s.sundayServiceId === sundayServiceId)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.startTime.localeCompare(b.startTime));
  }

  async createSeatingTime(
    actorUserId: string,
    input: CreateSeatingTimeInput,
  ): Promise<SeatingTimeOperationResult> {
    const windowError = validateSeatingWindow(input.startTime, input.endTime);
    if (windowError) return { success: false, error: windowError };
    if (!this.services.some((s) => s.id === input.sundayServiceId)) {
      return { success: false, error: "Sunday service not found." };
    }
    const now = new Date().toISOString();
    const newSeating: SeatingTimeDTO = {
      id: crypto.randomUUID(),
      sundayServiceId: input.sundayServiceId,
      label: input.label,
      startTime: input.startTime,
      endTime: input.endTime,
      onlineBookingLimit: input.onlineBookingLimit ?? null,
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    };
    this.seatingTimes.push(newSeating);
    return { success: true, data: { ...newSeating } };
  }

  async updateSeatingTime(
    actorUserId: string,
    input: UpdateSeatingTimeInput,
  ): Promise<SeatingTimeOperationResult> {
    const idx = this.seatingTimes.findIndex((s) => s.id === input.id);
    if (idx === -1) return { success: false, error: "Seating time not found." };
    const existing = this.seatingTimes[idx];
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This seating time was modified by another user. Please reload the latest data.",
      };
    }
    const startTime = input.startTime ?? existing.startTime;
    const endTime = input.endTime ?? existing.endTime;
    const windowError = validateSeatingWindow(startTime, endTime);
    if (windowError) return { success: false, error: windowError };
    const updated: SeatingTimeDTO = {
      ...existing,
      label: input.label ?? existing.label,
      startTime,
      endTime,
      onlineBookingLimit:
        input.onlineBookingLimit !== undefined
          ? input.onlineBookingLimit
          : existing.onlineBookingLimit,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      displayOrder: input.displayOrder !== undefined ? input.displayOrder : existing.displayOrder,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUserId,
    };
    this.seatingTimes[idx] = updated;
    return { success: true, data: { ...updated } };
  }

  async getPaymentPolicy(): Promise<PaymentPolicyDTO> {
    return { ...this.paymentPolicy };
  }

  async updatePaymentPolicy(
    actorUserId: string,
    input: UpdatePaymentPolicyInput,
  ): Promise<PaymentPolicyOperationResult> {
    if (this.paymentPolicy.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "Payment policy was modified by another user. Please reload the latest data.",
      };
    }
    const updated: PaymentPolicyDTO = {
      ...this.paymentPolicy,
      depositPercent: input.depositPercent,
      defaultBalanceDeadlineHours: input.defaultBalanceDeadlineHours,
      restaurantTimezone: input.restaurantTimezone,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUserId,
    };
    this.paymentPolicy = updated;
    return { success: true, data: { ...updated } };
  }

  // ------------------------------------------------------------------------
  // Physical dining tables
  // ------------------------------------------------------------------------
  private diningTables: (DiningTableDTO & { createdBy: string; updatedBy: string })[] = [];

  private static normalizeLabel(label: string): string {
    return label.trim().toLowerCase();
  }

  async listDiningTables(spaceId?: string): Promise<DiningTableDTO[]> {
    const filtered = spaceId
      ? this.diningTables.filter((t) => t.spaceId === spaceId)
      : [...this.diningTables];
    // Include inactive tables for management. Deterministic ordering.
    return filtered.sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
    );
  }

  async createDiningTable(
    actorUserId: string,
    input: CreateDiningTableInput,
  ): Promise<DiningTableOperationResult> {
    const label = input.label.trim();
    if (!label) {
      return { success: false, error: "Label is required." };
    }
    const norm = MockSundaysRepository.normalizeLabel(label);
    const duplicate = this.diningTables.some(
      (t) => t.spaceId === input.spaceId && MockSundaysRepository.normalizeLabel(t.label) === norm,
    );
    if (duplicate) {
      return {
        success: false,
        error: "A table with this label already exists in this room.",
      };
    }
    const now = new Date().toISOString();
    const newTable: DiningTableDTO & { createdBy: string; updatedBy: string } = {
      id: crypto.randomUUID(),
      spaceId: input.spaceId,
      label,
      seats: input.seats,
      zone: input.zone ?? "",
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    };
    this.diningTables.push(newTable);
    return { success: true, data: { ...newTable } };
  }

  async updateDiningTable(
    actorUserId: string,
    input: UpdateDiningTableInput,
  ): Promise<DiningTableOperationResult> {
    const idx = this.diningTables.findIndex((t) => t.id === input.id);
    if (idx === -1) {
      return { success: false, error: "Table not found." };
    }
    const existing = this.diningTables[idx];
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This table was modified by another user. Please reload the latest data.",
      };
    }
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) {
        return { success: false, error: "Label is required." };
      }
      const norm = MockSundaysRepository.normalizeLabel(label);
      const duplicate = this.diningTables.some(
        (t) =>
          t.id !== input.id &&
          t.spaceId === existing.spaceId &&
          MockSundaysRepository.normalizeLabel(t.label) === norm,
      );
      if (duplicate) {
        return {
          success: false,
          error: "A table with this label already exists in this room.",
        };
      }
    }
    const updated: DiningTableDTO & { createdBy: string; updatedBy: string } = {
      ...existing,
      label: input.label !== undefined ? input.label.trim() : existing.label,
      seats: input.seats ?? existing.seats,
      zone: input.zone !== undefined ? input.zone.trim() : existing.zone,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      displayOrder: input.displayOrder !== undefined ? input.displayOrder : existing.displayOrder,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(existing.updatedAt) + 1)).toISOString(),
      createdBy: existing.createdBy,
      updatedBy: actorUserId,
    };
    this.diningTables[idx] = updated;
    return { success: true, data: { ...updated } };
  }
}
