/**
 * Ordering pricing engine — behavioral tests.
 *
 * Exercises the single server-authoritative calculateOrder path: included
 * dishes are never charged again, platters are per-platter, discounts apply
 * only to configured scopes, and unavailable items are flagged not charged.
 * Mock tests only (migration unapplied).
 */
import { describe, it, expect } from "vitest";
import { calculateOrder, depositForSubtotal } from "@/lib/ordering/pricing";
import type { OrderGuest, OrderPlatterLine, PricingConfigSnapshot } from "@/lib/ordering/pricing";
import type {
  MealPackageDTO,
  IndividualAddonDTO,
  SharedPlatterDTO,
  GuestPricingRulesDTO,
  EligibleItemDTO,
} from "@/lib/ordering/types";

const MEAT_A = "11111111-0000-4000-8000-000000000001";
const MEAT_B = "11111111-0000-4000-8000-000000000002";
const SIDE_A = "22222222-0000-4000-8000-000000000001";
const SIDE_B = "22222222-0000-4000-8000-000000000002";
const SIDE_C = "22222222-0000-4000-8000-000000000003";

function makeEligible(pkgId: string, itemId: string, cat: string): EligibleItemDTO {
  return {
    id: crypto.randomUUID(),
    packageId: pkgId,
    menuItemId: itemId,
    menuItemName: `Item ${itemId.slice(-3)}`,
    selectionCategory: cat as EligibleItemDTO["selectionCategory"],
  };
}

function makePackage(overrides: Partial<MealPackageDTO> = {}): MealPackageDTO {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    name: "Basic Meal",
    slug: "basic-meal",
    description: "",
    pricePerPersonCents: 2950,
    includedMeatsCount: 2,
    includedSidesCount: 2,
    includesBread: true,
    includesSoftDrink: true,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    eligibleItems: [
      makeEligible(id, MEAT_A, "meat"),
      makeEligible(id, MEAT_B, "meat"),
      makeEligible(id, SIDE_A, "side"),
      makeEligible(id, SIDE_B, "side"),
    ],
    ...overrides,
  };
}

function makeAddon(overrides: Partial<IndividualAddonDTO> = {}): IndividualAddonDTO {
  return {
    id: crypto.randomUUID(),
    name: "Extra Dessert",
    slug: "extra-dessert",
    description: "",
    priceCents: 650,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    eligiblePackageIds: [],
    ...overrides,
  };
}

function makePlatter(overrides: Partial<SharedPlatterDTO> = {}): SharedPlatterDTO {
  return {
    id: crypto.randomUUID(),
    name: "Family Platter",
    slug: "family-platter",
    description: "",
    pricePerPlatterCents: 2500,
    servingGuidance: null,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function defaultRules(overrides: Partial<GuestPricingRulesDTO> = {}): GuestPricingRulesDTO {
  return {
    seniorDiscountPercent: 5,
    seniorMinAge: 65,
    seniorAppliesToPackages: true,
    seniorAppliesToAddons: false,
    seniorAppliesToPlatters: false,
    childRuleType: "none",
    childDiscountPercent: null,
    childFixedPackagePriceCents: null,
    childMaxAge: null,
    childAppliesToPackages: true,
    childAppliesToAddons: false,
    childAppliesToPlatters: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<PricingConfigSnapshot> = {}): PricingConfigSnapshot {
  return {
    packages: [makePackage()],
    addons: [],
    platters: [],
    rules: defaultRules(),
    ...overrides,
  };
}

function adultGuest(
  pkgId: string,
  selections: Array<{ menuItemId: string; selectionCategory: string }> = [],
  addons: Array<{ addonId: string; quantity: number }> = [],
): OrderGuest {
  return {
    id: crypto.randomUUID(),
    category: "adult",
    packageId: pkgId,
    includedSelections: selections,
    addons,
  };
}

function seniorGuest(
  pkgId: string,
  selections: Array<{ menuItemId: string; selectionCategory: string }> = [],
  addons: Array<{ addonId: string; quantity: number }> = [],
): OrderGuest {
  return {
    id: crypto.randomUUID(),
    category: "senior",
    packageId: pkgId,
    includedSelections: selections,
    addons,
  };
}

function childGuest(
  pkgId: string,
  selections: Array<{ menuItemId: string; selectionCategory: string }> = [],
  addons: Array<{ addonId: string; quantity: number }> = [],
): OrderGuest {
  return {
    id: crypto.randomUUID(),
    category: "child",
    packageId: pkgId,
    includedSelections: selections,
    addons,
  };
}

describe("calculateOrder — included dishes are not charged again", () => {
  it("charges only the package price, not catalog prices of included selections", () => {
    const pkg = makePackage({ pricePerPersonCents: 2950 });
    const config = makeConfig({ packages: [pkg] });
    const guest = adultGuest(pkg.id, [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ]);
    const result = calculateOrder([guest], [], config);
    const packageLines = result.lines.filter((l) => l.kind === "package");
    expect(packageLines).toHaveLength(1);
    expect(packageLines[0].amountCents).toBe(2950);
    expect(result.lines.filter((l) => l.kind === "addon")).toHaveLength(0);
    expect(result.subtotalCents).toBe(2950);
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("still charges only the package price even with invalid selections (no catalog fallback)", () => {
    const pkg = makePackage({ pricePerPersonCents: 2950 });
    const config = makeConfig({ packages: [pkg] });
    const guest = adultGuest(pkg.id, [{ menuItemId: MEAT_A, selectionCategory: "meat" }]);
    const result = calculateOrder([guest], [], config);
    expect(result.lines.filter((l) => l.kind === "package")).toHaveLength(1);
    expect(result.subtotalCents).toBe(2950);
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => n.includes("meats"))).toBe(true);
  });
});

describe("calculateOrder — mixed packages within one party", () => {
  it("charges different per-person prices for different packages", () => {
    const basic = makePackage({ id: "basic-id", slug: "basic", pricePerPersonCents: 2950 });
    const premium = makePackage({
      id: "premium-id",
      name: "Premium Meal",
      slug: "premium",
      pricePerPersonCents: 4450,
      includedSidesCount: 3,
      eligibleItems: [
        makeEligible("premium-id", MEAT_A, "meat"),
        makeEligible("premium-id", MEAT_B, "meat"),
        makeEligible("premium-id", SIDE_A, "side"),
        makeEligible("premium-id", SIDE_B, "side"),
        makeEligible("premium-id", SIDE_C, "side"),
      ],
    });
    const config = makeConfig({ packages: [basic, premium] });
    const guests = [
      adultGuest(basic.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ]),
      adultGuest(premium.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
        { menuItemId: SIDE_C, selectionCategory: "side" },
      ]),
    ];
    const result = calculateOrder(guests, [], config);
    expect(result.subtotalCents).toBe(2950 + 4450);
    expect(result.hasUnresolvedRules).toBe(false);
  });
});

describe("calculateOrder — individual add-ons", () => {
  it("charges add-ons per unit and only for eligible packages", () => {
    const pkg = makePackage({ id: "pkg-1" });
    const otherPkg = makePackage({ id: "pkg-2", slug: "other", name: "Other" });
    const addon = makeAddon({ id: "addon-1", priceCents: 650, eligiblePackageIds: ["pkg-1"] });
    const config = makeConfig({ packages: [pkg, otherPkg], addons: [addon] });
    const guests = [
      adultGuest(
        pkg.id,
        [
          { menuItemId: MEAT_A, selectionCategory: "meat" },
          { menuItemId: MEAT_B, selectionCategory: "meat" },
          { menuItemId: SIDE_A, selectionCategory: "side" },
          { menuItemId: SIDE_B, selectionCategory: "side" },
        ],
        [{ addonId: addon.id, quantity: 2 }],
      ),
      adultGuest(
        otherPkg.id,
        [
          { menuItemId: MEAT_A, selectionCategory: "meat" },
          { menuItemId: MEAT_B, selectionCategory: "meat" },
          { menuItemId: SIDE_A, selectionCategory: "side" },
          { menuItemId: SIDE_B, selectionCategory: "side" },
        ],
        [{ addonId: addon.id, quantity: 1 }],
      ),
    ];
    const result = calculateOrder(guests, [], config);
    expect(result.subtotalCents).toBe(4250 + 2950);
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => n.includes("not eligible"))).toBe(true);
  });

  it("treats empty eligiblePackageIds as eligible for all packages", () => {
    const pkg = makePackage();
    const addon = makeAddon({ eligiblePackageIds: [] });
    const config = makeConfig({ packages: [pkg], addons: [addon] });
    const guest = adultGuest(
      pkg.id,
      [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ],
      [{ addonId: addon.id, quantity: 1 }],
    );
    const result = calculateOrder([guest], [], config);
    expect(result.subtotalCents).toBe(2950 + 650);
    expect(result.hasUnresolvedRules).toBe(false);
  });
});

describe("calculateOrder — shared platters are per-platter, not per-guest", () => {
  it("charges per platter × quantity, never multiplied by guest count", () => {
    const pkg = makePackage();
    const platter = makePlatter({ pricePerPlatterCents: 2500 });
    const config = makeConfig({ packages: [pkg], platters: [platter] });
    const guests = [
      adultGuest(pkg.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ]),
      adultGuest(pkg.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ]),
    ];
    const platters: OrderPlatterLine[] = [{ platterId: platter.id, quantity: 3 }];
    const result = calculateOrder(guests, platters, config);
    expect(result.subtotalCents).toBe(13400);
    const platterLines = result.lines.filter((l) => l.kind === "platter");
    expect(platterLines).toHaveLength(1);
    expect(platterLines[0].amountCents).toBe(7500);
  });

  it("does not apply senior/child discounts to platters automatically", () => {
    const pkg = makePackage();
    const platter = makePlatter({ pricePerPlatterCents: 2500 });
    const config = makeConfig({ packages: [pkg], platters: [platter] });
    const guest = seniorGuest(pkg.id, [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ]);
    const result = calculateOrder([guest], [{ platterId: platter.id, quantity: 1 }], config);
    const packageLine = result.lines.find((l) => l.kind === "package")!;
    const discountLine = result.lines.find((l) => l.kind === "senior_discount")!;
    const platterLine = result.lines.find((l) => l.kind === "platter")!;
    // Gross package price charged; single discount line; platter full price.
    expect(packageLine.amountCents).toBe(2950);
    expect(discountLine.amountCents).toBe(-Math.round((2950 * 5) / 100));
    expect(platterLine.amountCents).toBe(2500);
    expect(result.subtotalCents).toBe(2950 - Math.round((2950 * 5) / 100) + 2500);
  });
});

describe("calculateOrder — senior discount", () => {
  it("applies 5% to the package when configured", () => {
    const pkg = makePackage();
    const config = makeConfig({ packages: [pkg], rules: defaultRules() });
    const guest = seniorGuest(pkg.id, [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ]);
    const result = calculateOrder([guest], [], config);
    expect(result.subtotalCents).toBe(2950 - Math.round((2950 * 5) / 100));
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("flags unresolved when senior age is not configured", () => {
    const pkg = makePackage();
    const config = makeConfig({ packages: [pkg], rules: defaultRules({ seniorMinAge: null }) });
    const guest = seniorGuest(pkg.id, [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ]);
    const result = calculateOrder([guest], [], config);
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => n.includes("Senior discount age"))).toBe(true);
    expect(result.subtotalCents).toBe(2950);
  });
});

describe("calculateOrder — child pricing", () => {
  it("flags unresolved when child rule is 'none' (not silently free)", () => {
    const pkg = makePackage();
    const config = makeConfig({ packages: [pkg], rules: defaultRules() });
    const guest = childGuest(pkg.id, [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ]);
    const result = calculateOrder([guest], [], config);
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => n.includes("Child pricing is not configured"))).toBe(
      true,
    );
    expect(result.subtotalCents).toBe(2950);
  });

  it("applies a fixed child package price when configured", () => {
    const pkg = makePackage();
    const config = makeConfig({
      packages: [pkg],
      rules: defaultRules({
        childRuleType: "fixed_package_price",
        childFixedPackagePriceCents: 1500,
        childMaxAge: 12,
      }),
    });
    const guest = childGuest(pkg.id, [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ]);
    const result = calculateOrder([guest], [], config);
    expect(result.subtotalCents).toBe(1500);
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("applies a percentage child discount when configured", () => {
    const pkg = makePackage();
    const config = makeConfig({
      packages: [pkg],
      rules: defaultRules({
        childRuleType: "percentage_discount",
        childDiscountPercent: 50,
        childMaxAge: 12,
      }),
    });
    const guest = childGuest(pkg.id, [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ]);
    const result = calculateOrder([guest], [], config);
    expect(result.subtotalCents).toBe(2950 - Math.round((2950 * 50) / 100));
    expect(result.hasUnresolvedRules).toBe(false);
  });
});

describe("calculateOrder — unavailable items are flagged, not charged", () => {
  it("flags an inactive package and does not charge", () => {
    const pkg = makePackage({ isActive: false });
    const config = makeConfig({ packages: [pkg] });
    const guest = adultGuest(pkg.id);
    const result = calculateOrder([guest], [], config);
    expect(result.subtotalCents).toBe(0);
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => n.includes("unavailable"))).toBe(true);
  });

  it("flags an inactive add-on and does not charge", () => {
    const pkg = makePackage();
    const addon = makeAddon({ isActive: false });
    const config = makeConfig({ packages: [pkg], addons: [addon] });
    const guest = adultGuest(
      pkg.id,
      [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ],
      [{ addonId: addon.id, quantity: 1 }],
    );
    const result = calculateOrder([guest], [], config);
    expect(result.subtotalCents).toBe(2950);
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => n.includes("add-on is unavailable"))).toBe(true);
  });

  it("flags an inactive platter and does not charge", () => {
    const pkg = makePackage();
    const platter = makePlatter({ isActive: false });
    const config = makeConfig({ packages: [pkg], platters: [platter] });
    const guest = adultGuest(pkg.id, [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ]);
    const result = calculateOrder([guest], [{ platterId: platter.id, quantity: 1 }], config);
    expect(result.subtotalCents).toBe(2950);
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => n.includes("platter is unavailable"))).toBe(true);
  });
});

describe("depositForSubtotal", () => {
  it("returns 50% of the subtotal", () => {
    expect(depositForSubtotal(10000)).toBe(5000);
    expect(depositForSubtotal(2950)).toBe(Math.round(2950 * 0.5));
  });
});
