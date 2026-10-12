/**
 * Sundays & Seating — typed TanStack Start server functions.
 *
 * Thin wrappers only. All runtime logic lives in the imported .server.ts
 * modules. Browser code imports these; the build replaces them with RPC stubs.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  serverListAllSundayServices,
  serverCreateSundayService,
  serverUpdateSundayService,
  serverListSeatingTimes,
  serverCreateSeatingTime,
  serverUpdateSeatingTime,
  serverGetPaymentPolicy,
  serverUpdatePaymentPolicy,
  serverListDiningTables,
  serverCreateDiningTable,
  serverUpdateDiningTable,
  serverListDiningTableRoomOptions,
} from "./server/sundays-actions.server";
import { serverAssignReservationTables } from "./server/reservation-tables-actions.server";
import { serverGetReservationTableContext } from "./server/reservation-tables-context.server";
import { serverCancelReservation } from "./server/reservation-cancel-actions.server";
import { serverConfirmReservation } from "./server/reservation-confirm-actions.server";
import { serverListServiceCapacityOptions } from "./server/service-capacity-options.server";
import type { ServiceCapacityOptionsResult } from "./sundays/service-capacity-options";
import { serverApproveReservation } from "./server/reservation-approval-actions.server";
import type { ApprovalResult } from "./sundays/types";
import type {
  SundayServiceDTO,
  SeatingTimeDTO,
  PaymentPolicyDTO,
  SundayServiceOperationResult,
  SeatingTimeOperationResult,
  PaymentPolicyOperationResult,
  DiningTableDTO,
  DiningTableListResult,
  DiningTableOperationResult,
  DiningTableRoomOptionsResult,
  DiningTableRoomOption,
  AssignTablesResult,
  ReservationTableContextResult,
  CancelReservationResult,
  ConfirmReservationResult,
} from "./sundays/types";

export const listAllSundayServices = createServerFn({ method: "GET" }).handler(async () => {
  return serverListAllSundayServices();
});

export const createSundayService = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverCreateSundayService(data);
  });

export const updateSundayService = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverUpdateSundayService(data);
  });

export const listSeatingTimes = createServerFn({ method: "GET" })
  .validator((d: { sundayServiceId: string }) => d)
  .handler(async ({ data }) => {
    return serverListSeatingTimes(data.sundayServiceId);
  });

export const createSeatingTime = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverCreateSeatingTime(data);
  });

export const updateSeatingTime = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverUpdateSeatingTime(data);
  });

export const getPaymentPolicy = createServerFn({ method: "GET" }).handler(async () => {
  return serverGetPaymentPolicy();
});

export const updatePaymentPolicy = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverUpdatePaymentPolicy(data);
  });

// ---------------------------------------------------------------------------
// Physical dining tables
// ---------------------------------------------------------------------------

export const listDiningTables = createServerFn({ method: "GET" })
  .validator((d: { spaceId?: string } | unknown) => d)
  .handler(async ({ data }) => {
    return serverListDiningTables(data);
  });

export const createDiningTable = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverCreateDiningTable(data);
  });

export const updateDiningTable = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverUpdateDiningTable(data);
  });

export const listDiningTableRoomOptions = createServerFn({ method: "GET" }).handler(async () => {
  return serverListDiningTableRoomOptions();
});

// ---------------------------------------------------------------------------
// Reservation table assignments
// ---------------------------------------------------------------------------

export const assignReservationTables = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverAssignReservationTables(data);
  });

export const getReservationTableContext = createServerFn({ method: "GET" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverGetReservationTableContext(data);
  });

export const cancelReservation = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverCancelReservation(data);
  });

export const confirmReservation = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverConfirmReservation(data);
  });

// ---------------------------------------------------------------------------
// Service capacity options
// ---------------------------------------------------------------------------

export const listServiceCapacityOptions = createServerFn({ method: "GET" })
  .validator((data: { spaceId: string }) => data)
  .handler(async ({ data }): Promise<ServiceCapacityOptionsResult> => {
    return serverListServiceCapacityOptions(data);
  });

// ---------------------------------------------------------------------------
// Management approval (late-booking deposit authorization)
// ---------------------------------------------------------------------------

export const approveReservationForPayment = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }): Promise<ApprovalResult> => {
    return serverApproveReservation(data);
  });

export type {
  SundayServiceDTO,
  SeatingTimeDTO,
  PaymentPolicyDTO,
  SundayServiceOperationResult,
  SeatingTimeOperationResult,
  PaymentPolicyOperationResult,
  DiningTableDTO,
  DiningTableListResult,
  DiningTableOperationResult,
  DiningTableRoomOptionsResult,
  DiningTableRoomOption,
  AssignTablesResult,
  ReservationTableContextResult,
  CancelReservationResult,
  ConfirmReservationResult,
  ServiceCapacityOptionsResult,
  ApprovalResult,
};
