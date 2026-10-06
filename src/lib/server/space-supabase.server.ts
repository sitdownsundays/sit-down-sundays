import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase-admin.server";
import type {
  VenueSpaceDTO,
  CreateVenueSpaceInput,
  UpdateVenueSpaceInput,
  VenueSpaceOperationResult,
} from "@/lib/spaces/types";
import type { ISpaceRepository } from "./space-repository-interface.server";
import type { SpaceType } from "@/lib/spaces/constants";

interface VenueSpaceRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  space_type: string;
  reported_capacity: number;
  online_booking_limit: number | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

function rowToDTO(row: VenueSpaceRow): VenueSpaceDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    spaceType: row.space_type as SpaceType,
    reportedCapacity: row.reported_capacity,
    onlineBookingLimit: row.online_booking_limit,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export class SupabaseSpaceRepository implements ISpaceRepository {
  private getAdmin(): SupabaseClient {
    // venue_spaces is internal config — uses the admin (service-role) client.
    // The server function verifies availability.manage before reaching here.
    return getAdminClient();
  }

  async listAllSpaces(): Promise<VenueSpaceDTO[]> {
    const { data, error } = await this.getAdmin()
      .from("venue_spaces")
      .select("*")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("Failed to list venue spaces:", error.message);
      return [];
    }
    return (data as VenueSpaceRow[]).map(rowToDTO);
  }

  async createSpace(
    actorUserId: string,
    input: CreateVenueSpaceInput,
  ): Promise<VenueSpaceOperationResult> {
    const payload = {
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      space_type: input.spaceType ?? "general_dining",
      reported_capacity: input.reportedCapacity ?? 0,
      online_booking_limit: input.onlineBookingLimit ?? null,
      is_active: input.isActive ?? true,
      display_order: input.displayOrder ?? 0,
      created_by: actorUserId,
      updated_by: actorUserId,
    };

    const { data, error } = await this.getAdmin()
      .from("venue_spaces")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("Failed to create venue space:", error.message);
      if (error.code === "23505") {
        return { success: false, error: "A space with this slug already exists" };
      }
      return { success: false, error: "Could not create space" };
    }
    return { success: true, space: rowToDTO(data as VenueSpaceRow) };
  }

  async updateSpace(
    actorUserId: string,
    input: UpdateVenueSpaceInput,
  ): Promise<VenueSpaceOperationResult> {
    // Optimistic-concurrency check.
    const { data: current, error: fetchError } = await this.getAdmin()
      .from("venue_spaces")
      .select("updated_at")
      .eq("id", input.id)
      .maybeSingle();

    if (fetchError || !current) {
      return { success: false, error: "Space not found" };
    }
    if (current.updated_at !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This space was modified by another user. Please reload the latest data.",
      };
    }

    const patch: Record<string, unknown> = { updated_by: actorUserId };
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.description !== undefined) patch.description = input.description;
    if (input.spaceType !== undefined) patch.space_type = input.spaceType;
    if (input.reportedCapacity !== undefined) patch.reported_capacity = input.reportedCapacity;
    if (input.onlineBookingLimit !== undefined)
      patch.online_booking_limit = input.onlineBookingLimit;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;

    const { data, error } = await this.getAdmin()
      .from("venue_spaces")
      .update(patch)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) {
      console.error("Failed to update venue space:", error.message);
      if (error.code === "23505") {
        return { success: false, error: "A space with this slug already exists" };
      }
      return { success: false, error: "Could not update space" };
    }
    return { success: true, space: rowToDTO(data as VenueSpaceRow) };
  }
}
