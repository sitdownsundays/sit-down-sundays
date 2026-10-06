/**
 * Ordering mock repository — eligible-items round-trip + concurrency tests.
 *
 * Behavioral tests against MockOrderingRepository: eligible items persist on
 * create, are replaced on update, preserved when omitted, and stale edits
 * return a conflict. Mock tests only (migration unapplied).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MockOrderingRepository } from "@/lib/server/ordering-mock.server";

const MEAT_A = "11111111-0000-4000-8000-000000000001";
const MEAT_B = "11111111-0000-4000-8000-000000000002";
const SIDE_A = "22222222-0000-4000-8000-000000000001";
const SIDE_B = "22222222-0000-4000-8000-000000000002";
const BREAD_A = "33333333-0000-4000-8000-000000000001";

describe("MockOrderingRepository — eligible-items round-trip", () => {
  let repo: MockOrderingRepository;

  beforeEach(() => {
    repo = new MockOrderingRepository();
  });

  it("persists eligible items on create and reloads them", async () => {
    const created = await repo.createPackage("actor-1", {
      name: "Test Package",
      slug: "test-package",
      description: "",
      pricePerPersonCents: 2950,
      includedMeatsCount: 2,
      includedSidesCount: 2,
      includesBread: true,
      includesSoftDrink: true,
      isActive: true,
      displayOrder: 0,
      eligibleItems: [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
      ],
    });
    expect(created.success).toBe(true);
    const pkg = created.data!;
    expect(pkg.eligibleItems).toHaveLength(2);
    expect(pkg.eligibleItems[0].menuItemId).toBe(MEAT_A);
    expect(pkg.eligibleItems[0].selectionCategory).toBe("meat");
    expect(pkg.eligibleItems[0].packageId).toBe(pkg.id);

    const list = await repo.listPackages();
    const reloaded = list.find((p) => p.id === pkg.id)!;
    expect(reloaded.eligibleItems).toHaveLength(2);
    expect(reloaded.eligibleItems.map((e) => e.menuItemId).sort()).toEqual([MEAT_A, SIDE_A]);
  });

  it("replaces the eligible-item set on update", async () => {
    const created = await repo.createPackage("actor-1", {
      name: "Test Package",
      slug: "test-package",
      description: "",
      pricePerPersonCents: 2950,
      includedMeatsCount: 2,
      includedSidesCount: 2,
      isActive: true,
      displayOrder: 0,
      eligibleItems: [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
      ],
    });
    const pkg = created.data!;
    const updated = await repo.updatePackage("actor-1", {
      id: pkg.id,
      expectedUpdatedAt: pkg.updatedAt,
      eligibleItems: [
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
        { menuItemId: BREAD_A, selectionCategory: "bread" },
      ],
    });
    expect(updated.success).toBe(true);
    expect(updated.data!.eligibleItems).toHaveLength(3);
    expect(updated.data!.eligibleItems.map((e) => e.menuItemId).sort()).toEqual(
      [BREAD_A, MEAT_B, SIDE_B].sort(),
    );
  });

  it("preserves existing eligible items when eligibleItems is omitted on update", async () => {
    const created = await repo.createPackage("actor-1", {
      name: "Test Package",
      slug: "test-package",
      description: "",
      pricePerPersonCents: 2950,
      includedMeatsCount: 2,
      includedSidesCount: 2,
      isActive: true,
      displayOrder: 0,
      eligibleItems: [{ menuItemId: MEAT_A, selectionCategory: "meat" }],
    });
    const pkg = created.data!;
    const updated = await repo.updatePackage("actor-1", {
      id: pkg.id,
      expectedUpdatedAt: pkg.updatedAt,
      name: "Renamed Package",
    });
    expect(updated.success).toBe(true);
    expect(updated.data!.name).toBe("Renamed Package");
    expect(updated.data!.eligibleItems).toHaveLength(1);
    expect(updated.data!.eligibleItems[0].menuItemId).toBe(MEAT_A);
  });

  it("rejects a stale update with a conflict", async () => {
    const created = await repo.createPackage("actor-1", {
      name: "Test Package",
      slug: "test-package",
      description: "",
      pricePerPersonCents: 2950,
      includedMeatsCount: 2,
      includedSidesCount: 2,
      isActive: true,
      displayOrder: 0,
    });
    const pkg = created.data!;
    await repo.updatePackage("actor-1", {
      id: pkg.id,
      expectedUpdatedAt: pkg.updatedAt,
      name: "First Edit",
    });
    const stale = await repo.updatePackage("actor-1", {
      id: pkg.id,
      expectedUpdatedAt: pkg.updatedAt,
      name: "Stale Edit",
    });
    expect(stale.success).toBe(false);
    expect(stale.conflict).toBe(true);
  });
});
