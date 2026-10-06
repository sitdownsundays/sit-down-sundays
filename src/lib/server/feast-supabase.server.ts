import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase-admin.server";
import { getAnonClient } from "./supabase-anon.server";
import type {
  FeastOfferingDTO,
  CreateFeastOfferingInput,
  UpdateFeastOfferingInput,
  FeastOfferingOperationResult,
} from "@/lib/feast/types";
import type { IFeastRepository } from "./feast-repository-interface.server";

interface FeastOfferingRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_per_person_cents: number | null;
  inclusions: string[];
  cover_image_url: string | null;
  cover_image_alt: string | null;
  is_published: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

function rowToDTO(row: FeastOfferingRow): FeastOfferingDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    pricePerPersonCents: row.price_per_person_cents,
    inclusions: row.inclusions ?? [],
    coverImageUrl: row.cover_image_url,
    coverImageAlt: row.cover_image_alt,
    isPublished: row.is_published,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export class SupabaseFeastRepository implements IFeastRepository {
  private getAdmin(): SupabaseClient {
    return getAdminClient();
  }

  private getAnon(): SupabaseClient {
    return getAnonClient();
  }

  async listPublishedOfferings(): Promise<FeastOfferingDTO[]> {
    // Public reads go through anonymous RLS-backed client (is_published = true only)
    const { data, error } = await this.getAnon()
      .from("feast_offerings")
      .select("*")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("Failed to list published feast offerings:", error.message);
      return [];
    }

    return (data as FeastOfferingRow[]).map(rowToDTO);
  }

  async listAllOfferings(): Promise<FeastOfferingDTO[]> {
    // Authorized CMS read — uses admin client to see drafts & published
    const { data, error } = await this.getAdmin()
      .from("feast_offerings")
      .select("*")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("Failed to list all feast offerings:", error.message);
      return [];
    }

    return (data as FeastOfferingRow[]).map(rowToDTO);
  }

  async getOfferingBySlug(slug: string): Promise<FeastOfferingDTO | null> {
    const { data, error } = await this.getAdmin()
      .from("feast_offerings")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return rowToDTO(data as FeastOfferingRow);
  }

  async createOffering(
    actorUserId: string,
    input: CreateFeastOfferingInput,
  ): Promise<FeastOfferingOperationResult> {
    const payload = {
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      price_per_person_cents: input.pricePerPersonCents ?? null,
      inclusions: input.inclusions ?? [],
      cover_image_url: input.coverImageUrl ?? null,
      cover_image_alt: input.coverImageAlt ?? null,
      is_published: input.isPublished ?? false,
      display_order: input.displayOrder ?? 0,
      created_by: actorUserId,
      updated_by: actorUserId,
    };

    const { data, error } = await this.getAdmin()
      .from("feast_offerings")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("Failed to create feast offering:", error.message);
      if (error.code === "23505") {
        return { success: false, error: "An offering with this slug already exists" };
      }
      return { success: false, error: "Could not create offering" };
    }

    return { success: true, offering: rowToDTO(data as FeastOfferingRow) };
  }

  async updateOffering(
    actorUserId: string,
    input: UpdateFeastOfferingInput,
  ): Promise<FeastOfferingOperationResult> {
    // Check concurrency
    const { data: current, error: fetchError } = await this.getAdmin()
      .from("feast_offerings")
      .select("updated_at")
      .eq("id", input.id)
      .maybeSingle();

    if (fetchError || !current) {
      return { success: false, error: "Offering not found" };
    }

    if (current.updated_at !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This offering was modified by another user. Please reload the latest data.",
      };
    }

    const patch: Record<string, unknown> = {
      updated_by: actorUserId,
    };

    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.description !== undefined) patch.description = input.description;
    if (input.pricePerPersonCents !== undefined)
      patch.price_per_person_cents = input.pricePerPersonCents;
    if (input.inclusions !== undefined) patch.inclusions = input.inclusions;
    if (input.coverImageUrl !== undefined) patch.cover_image_url = input.coverImageUrl;
    if (input.coverImageAlt !== undefined) patch.cover_image_alt = input.coverImageAlt;
    if (input.isPublished !== undefined) patch.is_published = input.isPublished;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;

    const { data, error } = await this.getAdmin()
      .from("feast_offerings")
      .update(patch)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) {
      console.error("Failed to update feast offering:", error.message);
      if (error.code === "23505") {
        return { success: false, error: "An offering with this slug already exists" };
      }
      return { success: false, error: "Could not update offering" };
    }

    return { success: true, offering: rowToDTO(data as FeastOfferingRow) };
  }

  async setOfferingPublished(
    actorUserId: string,
    id: string,
    isPublished: boolean,
    expectedUpdatedAt: string,
  ): Promise<FeastOfferingOperationResult> {
    return this.updateOffering(actorUserId, {
      id,
      expectedUpdatedAt,
      isPublished,
    });
  }
}
