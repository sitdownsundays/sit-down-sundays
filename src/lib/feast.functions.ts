import { createServerFn } from "@tanstack/react-start";
import {
  serverListPublishedOfferings,
  serverListAllOfferings,
  serverCreateOffering,
  serverUpdateOffering,
  serverSetOfferingPublished,
} from "./server/feast-actions.server";

export const listPublishedFeastOfferings = createServerFn({ method: "GET" }).handler(async () => {
  return serverListPublishedOfferings();
});

export const listAllFeastOfferings = createServerFn({ method: "GET" }).handler(async () => {
  return serverListAllOfferings();
});

export const createFeastOffering = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverCreateOffering(data);
  });

export const updateFeastOffering = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverUpdateOffering(data);
  });

export const setFeastOfferingPublished = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverSetOfferingPublished(data);
  });
