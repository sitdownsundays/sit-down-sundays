import type {
  FeastOfferingDTO,
  CreateFeastOfferingInput,
  UpdateFeastOfferingInput,
  FeastOfferingOperationResult,
} from "@/lib/feast/types";
import type { IFeastRepository } from "./feast-repository-interface.server";

// Standard seed offerings for mock mode or fallback
const INITIAL_OFFERINGS: FeastOfferingDTO[] = [
  {
    id: "f1000000-0000-0000-0000-000000000001",
    name: "Basic Meal",
    slug: "basic-meal",
    description:
      "A welcoming homestyle Sunday feast with generous portions of our traditional kitchen staples.",
    pricePerPersonCents: 2950,
    inclusions: [
      "Choice of 2 meats",
      "Choice of 2 sides",
      "Fresh rolls or warm cornbread",
      "Soft drink or tea included",
    ],
    coverImageUrl:
      "https://smbkptdcdxtoypcthfbb.supabase.co/storage/v1/object/public/menu-images/feast-offerings/basic-meal.jpg",
    coverImageAlt:
      "A comforting plate of slow-braised roast, corn on the cob, green beans, and mashed potatoes with savory gravy",
    isPublished: true,
    displayOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null,
  },
  {
    id: "f1000000-0000-0000-0000-000000000002",
    name: "Signature Meal",
    slug: "signature-meal",
    description:
      "Our signature dining experience featuring expanded meats and time-honored house specialties.",
    pricePerPersonCents: 3450,
    inclusions: [
      "Choice of 2 meats with expanded options",
      "Choice of 2 sides",
      "Fresh rolls or warm cornbread",
      "Soft drink or tea included",
    ],
    coverImageUrl:
      "https://smbkptdcdxtoypcthfbb.supabase.co/storage/v1/object/public/menu-images/feast-offerings/signature-meal.jpg",
    coverImageAlt:
      "Golden crispy fried chicken and fried shrimp served hot and fresh for the family table",
    isPublished: true,
    displayOrder: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null,
  },
  {
    id: "f1000000-0000-0000-0000-000000000003",
    name: "Premium Meal",
    slug: "premium-meal",
    description:
      "The complete Sunday gathering feast with premium meat cuts and three generous sides for every guest.",
    pricePerPersonCents: 4450,
    inclusions: [
      "Choice of 2 premium meats",
      "Choice of 3 sides",
      "Fresh rolls or warm cornbread",
      "Soft drink or tea included",
    ],
    coverImageUrl:
      "https://smbkptdcdxtoypcthfbb.supabase.co/storage/v1/object/public/menu-images/feast-offerings/premium-meal.jpg",
    coverImageAlt:
      "Oven-roasted chicken thighs, seasoned collard greens, homestyle potato salad, and golden cornbread",
    isPublished: true,
    displayOrder: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null,
  },
];

export class MockFeastRepository implements IFeastRepository {
  private offerings: FeastOfferingDTO[] = [...INITIAL_OFFERINGS];

  async listPublishedOfferings(): Promise<FeastOfferingDTO[]> {
    return this.offerings
      .filter((o) => o.isPublished)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  }

  async listAllOfferings(): Promise<FeastOfferingDTO[]> {
    return [...this.offerings].sort(
      (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
  }

  async getOfferingBySlug(slug: string): Promise<FeastOfferingDTO | null> {
    const found = this.offerings.find((o) => o.slug === slug);
    return found ? { ...found } : null;
  }

  async createOffering(
    actorUserId: string,
    input: CreateFeastOfferingInput,
  ): Promise<FeastOfferingOperationResult> {
    if (this.offerings.some((o) => o.slug === input.slug)) {
      return { success: false, error: "An offering with this slug already exists" };
    }

    const now = new Date().toISOString();
    const newOffering: FeastOfferingDTO = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      pricePerPersonCents: input.pricePerPersonCents ?? null,
      inclusions: input.inclusions ?? [],
      coverImageUrl: input.coverImageUrl ?? null,
      coverImageAlt: input.coverImageAlt ?? null,
      isPublished: input.isPublished ?? false,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    };

    this.offerings.push(newOffering);
    return { success: true, offering: { ...newOffering } };
  }

  async updateOffering(
    actorUserId: string,
    input: UpdateFeastOfferingInput,
  ): Promise<FeastOfferingOperationResult> {
    const idx = this.offerings.findIndex((o) => o.id === input.id);
    if (idx === -1) {
      return { success: false, error: "Offering not found" };
    }

    const existing = this.offerings[idx];
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      return {
        success: false,
        conflict: true,
        error: "This offering was modified by another user. Please reload the latest data.",
      };
    }

    if (input.slug && input.slug !== existing.slug) {
      if (this.offerings.some((o) => o.slug === input.slug && o.id !== input.id)) {
        return { success: false, error: "An offering with this slug already exists" };
      }
    }

    const now = new Date().toISOString();
    const updated: FeastOfferingDTO = {
      ...existing,
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      description: input.description !== undefined ? input.description : existing.description,
      pricePerPersonCents:
        input.pricePerPersonCents !== undefined
          ? input.pricePerPersonCents
          : existing.pricePerPersonCents,
      inclusions: input.inclusions !== undefined ? input.inclusions : existing.inclusions,
      coverImageUrl:
        input.coverImageUrl !== undefined ? input.coverImageUrl : existing.coverImageUrl,
      coverImageAlt:
        input.coverImageAlt !== undefined ? input.coverImageAlt : existing.coverImageAlt,
      isPublished: input.isPublished !== undefined ? input.isPublished : existing.isPublished,
      displayOrder: input.displayOrder !== undefined ? input.displayOrder : existing.displayOrder,
      updatedAt: now,
      updatedBy: actorUserId,
    };

    this.offerings[idx] = updated;
    return { success: true, offering: { ...updated } };
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
