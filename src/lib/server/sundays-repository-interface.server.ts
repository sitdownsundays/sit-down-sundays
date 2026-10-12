/**
 * SERVER-ONLY — Sundays & Seating repository contract.
 *
 * Internal configuration (Sunday services, seating times, payment policy).
 * No public read variant. All mutations are performed by the service-role
 * client inside authorized server functions after the caller's role is
 * verified to hold availability.manage (ops_manager / administrator).
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

export interface ISundaysRepository {
  // Sunday services
  listAllSundayServices(): Promise<SundayServiceDTO[]>;
  getSundayService(id: string): Promise<SundayServiceDTO | null>;
  createSundayService(
    actorUserId: string,
    input: CreateSundayServiceInput,
  ): Promise<SundayServiceOperationResult>;
  updateSundayService(
    actorUserId: string,
    input: UpdateSundayServiceInput,
  ): Promise<SundayServiceOperationResult>;

  // Seating times
  listSeatingTimesForService(sundayServiceId: string): Promise<SeatingTimeDTO[]>;
  createSeatingTime(
    actorUserId: string,
    input: CreateSeatingTimeInput,
  ): Promise<SeatingTimeOperationResult>;
  updateSeatingTime(
    actorUserId: string,
    input: UpdateSeatingTimeInput,
  ): Promise<SeatingTimeOperationResult>;

  // Payment policy (singleton)
  getPaymentPolicy(): Promise<PaymentPolicyDTO>;
  updatePaymentPolicy(
    actorUserId: string,
    input: UpdatePaymentPolicyInput,
  ): Promise<PaymentPolicyOperationResult>;

  // Capacity enforcement readiness (from capacity_control.ready).
  // Installed as false; the atomic submission RPC rejects new requests with
  // capacity_not_ready until activation. This read is advisory only — the RPC
  // remains authoritative.
  capacityReady(): Promise<boolean>;

  // Physical dining tables
  listDiningTables(spaceId?: string): Promise<DiningTableDTO[]>;
  createDiningTable(
    actorUserId: string,
    input: CreateDiningTableInput,
  ): Promise<DiningTableOperationResult>;
  updateDiningTable(
    actorUserId: string,
    input: UpdateDiningTableInput,
  ): Promise<DiningTableOperationResult>;
}
