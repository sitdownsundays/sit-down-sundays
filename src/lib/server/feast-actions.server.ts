import { z } from "zod";
import { resolveMenuActor } from "./menu-auth.server";
import { getFeastRepository } from "./feast-repository.server";
import { createFeastOfferingSchema, updateFeastOfferingSchema } from "@/lib/feast/schema";
import type { FeastOfferingDTO, FeastOfferingOperationResult } from "@/lib/feast/types";

export async function serverListPublishedOfferings(): Promise<FeastOfferingDTO[]> {
  const repo = getFeastRepository();
  return repo.listPublishedOfferings();
}

export async function serverListAllOfferings(): Promise<FeastOfferingDTO[]> {
  await resolveMenuActor(); // Requires CMS role
  const repo = getFeastRepository();
  return repo.listAllOfferings();
}

export async function serverCreateOffering(
  rawInput: unknown,
): Promise<FeastOfferingOperationResult> {
  const actor = await resolveMenuActor();
  const parsed = createFeastOfferingSchema.parse(rawInput);
  const repo = getFeastRepository();
  return repo.createOffering(actor.userId, parsed);
}

export async function serverUpdateOffering(
  rawInput: unknown,
): Promise<FeastOfferingOperationResult> {
  const actor = await resolveMenuActor();
  const parsed = updateFeastOfferingSchema.parse(rawInput);
  const repo = getFeastRepository();
  return repo.updateOffering(actor.userId, parsed);
}

export async function serverSetOfferingPublished(
  rawInput: unknown,
): Promise<FeastOfferingOperationResult> {
  const actor = await resolveMenuActor();
  const schema = z.object({
    id: z.string().uuid(),
    isPublished: z.boolean(),
    expectedUpdatedAt: z.string().min(1),
  });
  const parsed = schema.parse(rawInput);
  const repo = getFeastRepository();
  return repo.setOfferingPublished(
    actor.userId,
    parsed.id,
    parsed.isPublished,
    parsed.expectedUpdatedAt,
  );
}
