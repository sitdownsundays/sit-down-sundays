import type {
  VenueSpaceDTO,
  CreateVenueSpaceInput,
  UpdateVenueSpaceInput,
  VenueSpaceOperationResult,
} from "@/lib/spaces/types";
import type { ISpaceRepository } from "./space-repository-interface.server";
import type { SpaceType } from "@/lib/spaces/constants";

// Seed the three confirmed physical spaces. Suites intentionally omitted
// (count unknown, coming soon). online_booking_limit defaults to NULL so
// nothing is for sale until staff explicitly configures it.
const INITIAL_SPACES: VenueSpaceDTO[] = [
  {
    id: "v1000000-0000-0000-0000-000000000001",
    name: "Grand Ballroom",
    slug: "grand-ballroom",
    description: "The main general dining hall.",
    spaceType: "general_dining",
    reportedCapacity: 950,
    onlineBookingLimit: null,
    isActive: true,
    displayOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null,
  },
  {
    id: "v1000000-0000-0000-0000-000000000002",
    name: "Mayoral Room 1",
    slug: "mayoral-room-1",
    description: "Request-only private room for large gatherings. Staff approval required.",
    spaceType: "request_only",
    reportedCapacity: 60,
    onlineBookingLimit: null,
    isActive: true,
    displayOrder: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null,
  },
  {
    id: "v1000000-0000-0000-0000-000000000003",
    name: "Mayoral Room 2",
    slug: "mayoral-room-2",
    description: "Request-only private room for large gatherings. Staff approval required.",
    spaceType: "request_only",
    reportedCapacity: 60,
    onlineBookingLimit: null,
    isActive: true,
    displayOrder: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null,
  },
];

export class MockSpaceRepository implements ISpaceRepository {
  private spaces: VenueSpaceDTO[] = INITIAL_SPACES.map((s) => ({ ...s }));

  async listAllSpaces(): Promise<VenueSpaceDTO[]> {
    return [...this.spaces].sort(
      (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
  }

  async createSpace(
    actorUserId: string,
    input: CreateVenueSpaceInput,
  ): Promise<VenueSpaceOperationResult> {
    if (this.spaces.some((s) => s.slug === input.slug)) {
      return { success: false, error: "A space with this slug already exists" };
    }
    const now = new Date().toISOString();
    const newSpace: VenueSpaceDTO = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      spaceType: (input.spaceType ?? "general_dining") as SpaceType,
      reportedCapacity: input.reportedCapacity ?? 0,
      onlineBookingLimit: input.onlineBookingLimit ?? null,
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    };
    this.spaces.push(newSpace);
    return { success: true, space: { ...newSpace } };
  }

  async updateSpace(
    actorUserId: string,
    input: UpdateVenueSpaceInput,
  ): Promise<VenueSpaceOperationResult> {
    const idx = this.spaces.findIndex((s) => s.id === input.id);
    if (idx === -1) {
      return { success: false, error: "Space not found" };
    }
    const existing = this.spaces[idx];
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This space was modified by another user. Please reload the latest data.",
      };
    }
    if (input.slug && input.slug !== existing.slug) {
      if (this.spaces.some((s) => s.slug === input.slug && s.id !== input.id)) {
        return { success: false, error: "A space with this slug already exists" };
      }
    }
    const updated: VenueSpaceDTO = {
      ...existing,
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      description: input.description !== undefined ? input.description : existing.description,
      spaceType: input.spaceType ?? existing.spaceType,
      reportedCapacity: input.reportedCapacity ?? existing.reportedCapacity,
      onlineBookingLimit:
        input.onlineBookingLimit !== undefined
          ? input.onlineBookingLimit
          : existing.onlineBookingLimit,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      displayOrder: input.displayOrder !== undefined ? input.displayOrder : existing.displayOrder,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUserId,
    };
    this.spaces[idx] = updated;
    return { success: true, space: { ...updated } };
  }
}
