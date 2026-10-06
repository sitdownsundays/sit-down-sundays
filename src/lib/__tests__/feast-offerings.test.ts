import { describe, it, expect, beforeEach } from "vitest";
import { MockFeastRepository } from "@/lib/server/feast-mock.server";
import { createFeastOfferingSchema, updateFeastOfferingSchema } from "@/lib/feast/schema";

describe("Feast Offerings Schema & Repository", () => {
  let repo: MockFeastRepository;

  beforeEach(() => {
    repo = new MockFeastRepository();
  });

  it("lists published offerings sorted by displayOrder", async () => {
    const list = await repo.listPublishedOfferings();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0].slug).toBe("basic-meal");
    expect(list[1].slug).toBe("signature-meal");
    expect(list[2].slug).toBe("premium-meal");
    expect(list[0].pricePerPersonCents).toBe(2950);
    expect(list[1].pricePerPersonCents).toBe(3450);
    expect(list[2].pricePerPersonCents).toBe(4450);
  });

  it("validates create schema requires name, valid slug, and cover-alt if image present", () => {
    // Valid
    const valid = createFeastOfferingSchema.safeParse({
      name: "Custom Feast",
      slug: "custom-feast",
      description: "Nice feast",
      pricePerPersonCents: 3500,
      inclusions: ["Item 1", "Item 2"],
      coverImageUrl: "https://example.com/img.jpg",
      coverImageAlt: "A beautiful platter of food",
      isPublished: true,
      displayOrder: 4,
    });
    expect(valid.success).toBe(true);

    // Missing alt text when image present
    const missingAlt = createFeastOfferingSchema.safeParse({
      name: "Custom Feast",
      slug: "custom-feast",
      coverImageUrl: "https://example.com/img.jpg",
      coverImageAlt: "",
    });
    expect(missingAlt.success).toBe(false);
  });

  it("enforces optimistic concurrency on update", async () => {
    const list = await repo.listAllOfferings();
    const item = list[0];

    const result = await repo.updateOffering("user-1", {
      id: item.id,
      expectedUpdatedAt: "stale-timestamp",
      name: "Updated Name",
    });

    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
  });

  it("updates and toggles publication status with valid expectedUpdatedAt", async () => {
    const list = await repo.listAllOfferings();
    const item = list[0];

    const result = await repo.setOfferingPublished("user-1", item.id, false, item.updatedAt);
    expect(result.success).toBe(true);
    expect(result.offering?.isPublished).toBe(false);

    const published = await repo.listPublishedOfferings();
    expect(published.some((p) => p.id === item.id)).toBe(false);
  });
});
