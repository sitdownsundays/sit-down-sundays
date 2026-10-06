/**
 * Venue Spaces — DTOs and operation inputs.
 *
 * Independent of the Menu CMS and booking engine. Client-safe.
 */
import type { SpaceType } from "./constants";

export interface VenueSpaceDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  spaceType: SpaceType;
  reportedCapacity: number;
  onlineBookingLimit: number | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CreateVenueSpaceInput {
  name: string;
  slug: string;
  description?: string;
  spaceType?: SpaceType;
  reportedCapacity?: number;
  onlineBookingLimit?: number | null;
  isActive?: boolean;
  displayOrder?: number;
}

export interface UpdateVenueSpaceInput {
  id: string;
  /** Required for optimistic-concurrency protection. */
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  description?: string;
  spaceType?: SpaceType;
  reportedCapacity?: number;
  onlineBookingLimit?: number | null;
  isActive?: boolean;
  displayOrder?: number;
}

export interface VenueSpaceOperationResult {
  success: boolean;
  space?: VenueSpaceDTO;
  error?: string;
  conflict?: boolean;
}
