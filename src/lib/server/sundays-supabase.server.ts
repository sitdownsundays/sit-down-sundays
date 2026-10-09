/**
 * SERVER-ONLY — Supabase Sundays & Seating repository.
 *
 * Uses the admin (service-role) client. venue_spaces, sunday_services,
 * seating_times, and payment_policy are INTERNAL configuration — no public
 * read variant. The server function verifies availability.manage before
 * reaching here. service_role bypasses RLS.
 *
 * Enforces the same service-window validation as the mock repository and the
 * database CHECK constraints. Returns safe, secret-free errors; raw Supabase
 * errors are logged server-side only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase-admin.server";
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
} from "@/lib/sundays/constants";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const WINDOW_START_MIN = toMinutes(SERVICE_WINDOW_START);
const WINDOW_END_MIN = toMinutes(SERVICE_WINDOW_END);
const LATEST_START_MIN = toMinutes(LATEST_RESERVATION_START);

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

interface SundayServiceRow {
  id: string;
  date: string;
  label: string;
  status: string;
  space_id: string;
  online_booking_limit: number | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

interface SeatingTimeRow {
  id: string;
  sunday_service_id: string;
  label: string;
  start_time: string;
  end_time: string;
  online_booking_limit: number | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

interface PaymentPolicyRow {
  id: string;
  deposit_percent: number;
  default_balance_deadline_hours: number;
  restaurant_timezone: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

interface DiningTableRow {
  id: string;
  space_id: string;
  label: string;
  seats: number;
  zone: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

function diningRowToDTO(row: DiningTableRow): DiningTableDTO {
  return {
    id: row.id,
    spaceId: row.space_id,
    label: row.label,
    seats: row.seats as TableSize,
    zone: row.zone,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serviceRowToDTO(row: SundayServiceRow): SundayServiceDTO {
  return {
    id: row.id,
    date: row.date,
    label: row.label,
    status: row.status as SundayStatus,
    spaceId: row.space_id,
    onlineBookingLimit: row.online_booking_limit,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function seatingRowToDTO(row: SeatingTimeRow): SeatingTimeDTO {
  return {
    id: row.id,
    sundayServiceId: row.sunday_service_id,
    label: row.label,
    startTime: row.start_time,
    endTime: row.end_time,
    onlineBookingLimit: row.online_booking_limit,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

const DEFAULT_POLICY: PaymentPolicyDTO = {
  depositPercent: 50,
  defaultBalanceDeadlineHours: 72,
  restaurantTimezone: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: null,
  updatedBy: null,
};

export class SupabaseSundaysRepository implements ISundaysRepository {
  private getAdmin(): SupabaseClient {
    return getAdminClient();
  }

  async listAllSundayServices(): Promise<SundayServiceDTO[]> {
    const { data, error } = await this.getAdmin()
      .from("sunday_services")
      .select("*")
      .order("display_order", { ascending: true })
      .order("date", { ascending: true });
    if (error) {
      console.error("Failed to list Sunday services:", error.message);
      return [];
    }
    return (data as SundayServiceRow[]).map(serviceRowToDTO);
  }

  async getSundayService(id: string): Promise<SundayServiceDTO | null> {
    const { data, error } = await this.getAdmin()
      .from("sunday_services")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return serviceRowToDTO(data as SundayServiceRow);
  }

  async createSundayService(
    actorUserId: string,
    input: CreateSundayServiceInput,
  ): Promise<SundayServiceOperationResult> {
    const payload = {
      date: input.date,
      label: input.label ?? "",
      status: input.status ?? "scheduled",
      space_id: input.spaceId,
      online_booking_limit: input.onlineBookingLimit ?? null,
      is_active: input.isActive ?? true,
      display_order: input.displayOrder ?? 0,
      created_by: actorUserId,
      updated_by: actorUserId,
    };
    const { data, error } = await this.getAdmin()
      .from("sunday_services")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      console.error("Failed to create Sunday service:", error.message);
      return { success: false, error: "Could not create Sunday service." };
    }
    return { success: true, data: serviceRowToDTO(data as SundayServiceRow) };
  }

  async updateSundayService(
    actorUserId: string,
    input: UpdateSundayServiceInput,
  ): Promise<SundayServiceOperationResult> {
    // Preliminary fetch for merged-state validation only — NOT the concurrency
    // guard. Optimistic concurrency is enforced in the UPDATE itself via
    // WHERE id = ? AND updated_at = expectedUpdatedAt, so a stale edit updates
    // zero rows and returns a safe conflict instead of silently overwriting.
    const patch: Record<string, unknown> = { updated_by: actorUserId };
    if (input.date !== undefined) patch.date = input.date;
    if (input.label !== undefined) patch.label = input.label;
    if (input.status !== undefined) patch.status = input.status;
    if (input.spaceId !== undefined) patch.space_id = input.spaceId;
    if (input.onlineBookingLimit !== undefined)
      patch.online_booking_limit = input.onlineBookingLimit;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;

    const { data, error } = await this.getAdmin()
      .from("sunday_services")
      .update(patch)
      .eq("id", input.id)
      .eq("updated_at", input.expectedUpdatedAt)
      .select("*")
      .maybeSingle();
    if (error) {
      console.error("Failed to update Sunday service:", error.message);
      return { success: false, error: "Could not update Sunday service." };
    }
    if (!data) {
      // Zero rows updated: either the record was deleted or updated_at changed
      // (stale edit). Distinguish by checking existence.
      const { data: exists } = await this.getAdmin()
        .from("sunday_services")
        .select("id")
        .eq("id", input.id)
        .maybeSingle();
      if (!exists) return { success: false, error: "Sunday service not found." };
      return {
        success: false,
        conflict: true,
        error: "This Sunday service was modified by another user. Please reload the latest data.",
      };
    }
    return { success: true, data: serviceRowToDTO(data as SundayServiceRow) };
  }

  async listSeatingTimesForService(sundayServiceId: string): Promise<SeatingTimeDTO[]> {
    const { data, error } = await this.getAdmin()
      .from("seating_times")
      .select("*")
      .eq("sunday_service_id", sundayServiceId)
      .order("display_order", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) {
      console.error("Failed to list seating times:", error.message);
      return [];
    }
    return (data as SeatingTimeRow[]).map(seatingRowToDTO);
  }

  async createSeatingTime(
    actorUserId: string,
    input: CreateSeatingTimeInput,
  ): Promise<SeatingTimeOperationResult> {
    const windowError = validateSeatingWindow(input.startTime, input.endTime);
    if (windowError) return { success: false, error: windowError };
    const payload = {
      sunday_service_id: input.sundayServiceId,
      label: input.label,
      start_time: input.startTime,
      end_time: input.endTime,
      online_booking_limit: input.onlineBookingLimit ?? null,
      is_active: input.isActive ?? true,
      display_order: input.displayOrder ?? 0,
      created_by: actorUserId,
      updated_by: actorUserId,
    };
    const { data, error } = await this.getAdmin()
      .from("seating_times")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      console.error("Failed to create seating time:", error.message);
      return { success: false, error: "Could not create seating time." };
    }
    return { success: true, data: seatingRowToDTO(data as SeatingTimeRow) };
  }

  async updateSeatingTime(
    actorUserId: string,
    input: UpdateSeatingTimeInput,
  ): Promise<SeatingTimeOperationResult> {
    // Preliminary fetch for merged-state window validation only — NOT the
    // concurrency guard. Optimistic concurrency is enforced in the UPDATE via
    // WHERE id = ? AND updated_at = expectedUpdatedAt.
    const { data: current, error: fetchError } = await this.getAdmin()
      .from("seating_times")
      .select("updated_at, start_time, end_time")
      .eq("id", input.id)
      .maybeSingle();
    if (fetchError || !current) {
      return { success: false, error: "Seating time not found." };
    }
    const row = current as { updated_at: string; start_time: string; end_time: string };
    const startTime = input.startTime ?? row.start_time;
    const endTime = input.endTime ?? row.end_time;
    const windowError = validateSeatingWindow(startTime, endTime);
    if (windowError) return { success: false, error: windowError };

    const patch: Record<string, unknown> = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.startTime !== undefined) patch.start_time = input.startTime;
    if (input.endTime !== undefined) patch.end_time = input.endTime;
    if (input.onlineBookingLimit !== undefined)
      patch.online_booking_limit = input.onlineBookingLimit;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    patch.updated_by = actorUserId;

    const { data, error } = await this.getAdmin()
      .from("seating_times")
      .update(patch)
      .eq("id", input.id)
      .eq("updated_at", input.expectedUpdatedAt)
      .select("*")
      .maybeSingle();
    if (error) {
      console.error("Failed to update seating time:", error.message);
      return { success: false, error: "Could not update seating time." };
    }
    if (!data) {
      const { data: exists } = await this.getAdmin()
        .from("seating_times")
        .select("id")
        .eq("id", input.id)
        .maybeSingle();
      if (!exists) return { success: false, error: "Seating time not found." };
      return {
        success: false,
        conflict: true,
        error: "This seating time was modified by another user. Please reload the latest data.",
      };
    }
    return { success: true, data: seatingRowToDTO(data as SeatingTimeRow) };
  }

  async getPaymentPolicy(): Promise<PaymentPolicyDTO> {
    const { data, error } = await this.getAdmin()
      .from("payment_policy")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) {
      // Table not yet applied or empty — return safe defaults.
      return { ...DEFAULT_POLICY };
    }
    const row = data as PaymentPolicyRow;
    return {
      depositPercent: row.deposit_percent,
      defaultBalanceDeadlineHours: row.default_balance_deadline_hours,
      restaurantTimezone: row.restaurant_timezone,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
    };
  }

  async updatePaymentPolicy(
    actorUserId: string,
    input: UpdatePaymentPolicyInput,
  ): Promise<PaymentPolicyOperationResult> {
    // Preliminary fetch only to decide insert-vs-update. Optimistic concurrency
    // is enforced in the UPDATE via WHERE id = 1 AND updated_at = expected.
    const { data: current, error: fetchError } = await this.getAdmin()
      .from("payment_policy")
      .select("updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (fetchError) {
      console.error("Failed to load payment policy:", fetchError.message);
      return { success: false, error: "Could not load payment policy." };
    }
    // If no row exists yet, upsert with the singleton id.
    if (!current) {
      const payload = {
        id: 1,
        deposit_percent: input.depositPercent,
        default_balance_deadline_hours: input.defaultBalanceDeadlineHours,
        restaurant_timezone: input.restaurantTimezone,
        created_by: actorUserId,
        updated_by: actorUserId,
      };
      const { data, error } = await this.getAdmin()
        .from("payment_policy")
        .upsert(payload)
        .select("*")
        .single();
      if (error) {
        console.error("Failed to create payment policy:", error.message);
        return { success: false, error: "Could not save payment policy." };
      }
      const row = data as PaymentPolicyRow;
      return {
        success: true,
        data: {
          depositPercent: row.deposit_percent,
          defaultBalanceDeadlineHours: row.default_balance_deadline_hours,
          restaurantTimezone: row.restaurant_timezone,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          createdBy: row.created_by,
          updatedBy: row.updated_by,
        },
      };
    }
    const patch = {
      deposit_percent: input.depositPercent,
      default_balance_deadline_hours: input.defaultBalanceDeadlineHours,
      restaurant_timezone: input.restaurantTimezone,
      updated_by: actorUserId,
    };
    const { data, error } = await this.getAdmin()
      .from("payment_policy")
      .update(patch)
      .eq("id", 1)
      .eq("updated_at", input.expectedUpdatedAt)
      .select("*")
      .maybeSingle();
    if (error) {
      console.error("Failed to update payment policy:", error.message);
      return { success: false, error: "Could not save payment policy." };
    }
    if (!data) {
      // Singleton always exists once seeded; zero rows means a stale edit.
      return {
        success: false,
        conflict: true,
        error: "Payment policy was modified by another user. Please reload the latest data.",
      };
    }
    const row = data as PaymentPolicyRow;
    return {
      success: true,
      data: {
        depositPercent: row.deposit_percent,
        defaultBalanceDeadlineHours: row.default_balance_deadline_hours,
        restaurantTimezone: row.restaurant_timezone,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by,
        updatedBy: row.updated_by,
      },
    };
  }

  // ------------------------------------------------------------------------
  // Physical dining tables
  // ------------------------------------------------------------------------
  private static normalizeLabel(label: string): string {
    return label.trim().toLowerCase();
  }

  async listDiningTables(spaceId?: string): Promise<DiningTableDTO[]> {
    let query = this.getAdmin().from("dining_tables").select("*");
    if (spaceId) query = query.eq("space_id", spaceId);
    const { data, error } = await query
      .order("display_order", { ascending: true })
      .order("label", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.error("Failed to list dining tables:", error.message);
      throw new Error("Could not list dining tables.");
    }
    return (data as DiningTableRow[]).map(diningRowToDTO);
  }

  async createDiningTable(
    actorUserId: string,
    input: CreateDiningTableInput,
  ): Promise<DiningTableOperationResult> {
    const label = input.label.trim();
    if (!label) {
      return { success: false, error: "Label is required." };
    }
    const payload = {
      space_id: input.spaceId,
      label,
      seats: input.seats,
      zone: input.zone ?? "",
      is_active: input.isActive ?? true,
      display_order: input.displayOrder ?? 0,
      created_by: actorUserId,
      updated_by: actorUserId,
    };
    const { data, error } = await this.getAdmin()
      .from("dining_tables")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      // Unique constraint violation on (space_id, normalized label) → duplicate.
      if (error.code === "23505") {
        return {
          success: false,
          error: "A table with this label already exists in this room.",
        };
      }
      console.error("Failed to create dining table:", error.message);
      return { success: false, error: "Could not create dining table." };
    }
    return { success: true, data: diningRowToDTO(data as DiningTableRow) };
  }

  async updateDiningTable(
    actorUserId: string,
    input: UpdateDiningTableInput,
  ): Promise<DiningTableOperationResult> {
    const patch: Record<string, unknown> = { updated_by: actorUserId };
    if (input.label !== undefined) patch.label = input.label.trim();
    if (input.seats !== undefined) patch.seats = input.seats;
    if (input.zone !== undefined) patch.zone = input.zone.trim();
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;

    const { data, error } = await this.getAdmin()
      .from("dining_tables")
      .update(patch)
      .eq("id", input.id)
      .eq("updated_at", input.expectedUpdatedAt)
      .select("*")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") {
        return {
          success: false,
          error: "A table with this label already exists in this room.",
        };
      }
      console.error("Failed to update dining table:", error.message);
      return { success: false, error: "Could not update dining table." };
    }
    if (!data) {
      // Zero rows updated: either the record was deleted or updated_at changed
      // (stale edit). Distinguish by checking existence.
      const { data: exists } = await this.getAdmin()
        .from("dining_tables")
        .select("id")
        .eq("id", input.id)
        .maybeSingle();
      if (!exists) return { success: false, error: "Table not found." };
      return {
        success: false,
        conflict: true,
        error: "This table was modified by another user. Please reload the latest data.",
      };
    }
    return { success: true, data: diningRowToDTO(data as DiningTableRow) };
  }
}
