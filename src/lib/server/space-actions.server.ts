/**
 * SERVER-ONLY — venue spaces server actions.
 *
 * Thin handlers: resolve the authorized actor (availability.manage), validate
 * input with the strict schemas, and delegate to the repository. No raw
 * Supabase errors reach the caller. Protected fields (id, audit, timestamps,
 * identity) are never accepted from the browser.
 */
import { createVenueSpaceSchema, updateVenueSpaceSchema } from "@/lib/spaces/schema";
import { getSpaceRepository } from "./space-repository.server";
import { resolveSpaceActor, SpaceAuthorizationError } from "./space-auth.server";
import type { VenueSpaceDTO, VenueSpaceOperationResult } from "@/lib/spaces/types";

/** A neutral, secret-free error returned when the caller is not authorized. */
const UNAUTHORIZED: VenueSpaceOperationResult = {
  success: false,
  error: "You are not authorized to perform this action.",
};

/**
 * List all venue spaces. Requires availability.manage (ops_manager /
 * administrator). venue_spaces is internal config, so there is no public
 * read variant.
 */
export async function serverListAllSpaces(): Promise<VenueSpaceDTO[]> {
  try {
    await resolveSpaceActor();
  } catch {
    return [];
  }
  const repo = getSpaceRepository();
  return repo.listAllSpaces();
}

export async function serverCreateSpace(rawInput: unknown): Promise<VenueSpaceOperationResult> {
  let actor;
  try {
    actor = await resolveSpaceActor();
  } catch {
    return UNAUTHORIZED;
  }
  try {
    const parsed = createVenueSpaceSchema.parse(rawInput);
    const repo = getSpaceRepository();
    return repo.createSpace(actor.userId, parsed);
  } catch {
    // Validation failure — return a safe generic error. Field-level detail is
    // produced client-side from the same schema before the call.
    return { success: false, error: "Could not create space. Check your entries and try again." };
  }
}

export async function serverUpdateSpace(rawInput: unknown): Promise<VenueSpaceOperationResult> {
  let actor;
  try {
    actor = await resolveSpaceActor();
  } catch (e) {
    if (e instanceof SpaceAuthorizationError) return UNAUTHORIZED;
    return UNAUTHORIZED;
  }
  try {
    const parsed = updateVenueSpaceSchema.parse(rawInput);
    const repo = getSpaceRepository();
    return repo.updateSpace(actor.userId, parsed);
  } catch {
    return { success: false, error: "Could not update space. Check your entries and try again." };
  }
}
