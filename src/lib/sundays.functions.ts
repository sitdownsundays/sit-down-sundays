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
} from "./server/sundays-actions.server";
import type {
  SundayServiceDTO,
  SeatingTimeDTO,
  PaymentPolicyDTO,
  SundayServiceOperationResult,
  SeatingTimeOperationResult,
  PaymentPolicyOperationResult,
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

export type {
  SundayServiceDTO,
  SeatingTimeDTO,
  PaymentPolicyDTO,
  SundayServiceOperationResult,
  SeatingTimeOperationResult,
  PaymentPolicyOperationResult,
};
