import { createServerFn } from "@tanstack/react-start";
import {
  serverListAllSpaces,
  serverCreateSpace,
  serverUpdateSpace,
} from "./server/space-actions.server";
import type { VenueSpaceDTO, VenueSpaceOperationResult } from "./spaces/types";

export const listAllVenueSpaces = createServerFn({ method: "GET" }).handler(async () => {
  return serverListAllSpaces();
});

export const createVenueSpace = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverCreateSpace(data);
  });

export const updateVenueSpace = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    return serverUpdateSpace(data);
  });

export type { VenueSpaceDTO, VenueSpaceOperationResult };
