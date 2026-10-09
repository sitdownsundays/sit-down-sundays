import type {
  FeastOfferingDTO,
  CreateFeastOfferingInput,
  UpdateFeastOfferingInput,
  FeastOfferingOperationResult,
} from "@/lib/feast/types";

export interface IFeastRepository {
  listPublishedOfferings(): Promise<FeastOfferingDTO[]>;
  listAllOfferings(): Promise<FeastOfferingDTO[]>;
  getOfferingBySlug(slug: string): Promise<FeastOfferingDTO | null>;
  createOffering(
    actorUserId: string,
    input: CreateFeastOfferingInput,
  ): Promise<FeastOfferingOperationResult>;
  updateOffering(
    actorUserId: string,
    input: UpdateFeastOfferingInput,
  ): Promise<FeastOfferingOperationResult>;
  setOfferingPublished(
    actorUserId: string,
    id: string,
    isPublished: boolean,
    expectedUpdatedAt: string,
  ): Promise<FeastOfferingOperationResult>;
}
