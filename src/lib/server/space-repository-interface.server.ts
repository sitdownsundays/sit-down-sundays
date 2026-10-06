import type {
  VenueSpaceDTO,
  CreateVenueSpaceInput,
  UpdateVenueSpaceInput,
  VenueSpaceOperationResult,
} from "@/lib/spaces/types";

export interface ISpaceRepository {
  listAllSpaces(): Promise<VenueSpaceDTO[]>;
  createSpace(
    actorUserId: string,
    input: CreateVenueSpaceInput,
  ): Promise<VenueSpaceOperationResult>;
  updateSpace(
    actorUserId: string,
    input: UpdateVenueSpaceInput,
  ): Promise<VenueSpaceOperationResult>;
}
