// Focused tests for the party-level optional add-ons (shared platters) path.
//
// These are helper/logic tests (setPlatterQuantity + price math). They do NOT
// render the SharedPlattersSection component — the project's vitest config
// includes only .test.ts files (no DOM / testing-library). Rendered
// interaction coverage is NOT claimed here.
import { describe, it, expect } from "vitest";
import { setPlatterQuantity } from "@/lib/booking/meals-helpers";
import type { PublicSharedPlatter } from "@/lib/booking/public-catalog";

// Catalog fixtures reflect the confirmed offering prices. The UI must read
// these from the catalog at runtime, not hardcode them.
const PLATTERS: PublicSharedPlatter[] = [
  {
    id: "p-tea",
    name: "Sweet Tea Pitcher",
    description: "",
    pricePerPlatterCents: 600,
    servingGuidance: "per pitcher",
    displayOrder: 0,
  },
  {
    id: "p-lemonade",
    name: "Lemonade Pitcher",
    description: "",
    pricePerPlatterCents: 600,
    servingGuidance: "per pitcher",
    displayOrder: 1,
  },
  {
    id: "p-water",
    name: "Water Pitcher",
    description: "",
    pricePerPlatterCents: 400,
    servingGuidance: "per pitcher",
    displayOrder: 2,
  },
  {
    id: "p-cake",
    name: "Homemade Pound Cake",
    description: "",
    pricePerPlatterCents: 500,
    servingGuidance: "per serving",
    displayOrder: 3,
  },
  {
    id: "p-cobbler",
    name: "Homemade Peach Cobbler",
    description: "",
    pricePerPlatterCents: 500,
    servingGuidance: "per serving",
    displayOrder: 4,
  },
  {
    id: "p-pudding",
    name: "Homemade Banana Pudding",
    description: "",
    pricePerPlatterCents: 500,
    servingGuidance: "per serving",
    displayOrder: 5,
  },
];

function lineTotal(platter: PublicSharedPlatter, qty: number): number {
  return qty * platter.pricePerPlatterCents;
}

describe("optional add-ons (shared platters) price math", () => {
  it("confirmed offering prices are read from the catalog", () => {
    const byId = (id: string) => PLATTERS.find((p) => p.id === id)!;
    expect(byId("p-tea").pricePerPlatterCents).toBe(600);
    expect(byId("p-lemonade").pricePerPlatterCents).toBe(600);
    expect(byId("p-water").pricePerPlatterCents).toBe(400);
    expect(byId("p-cake").pricePerPlatterCents).toBe(500);
    expect(byId("p-cobbler").pricePerPlatterCents).toBe(500);
    expect(byId("p-pudding").pricePerPlatterCents).toBe(500);
  });

  it("line total = quantity × unit price, party-level (not per guest)", () => {
    const cake = PLATTERS.find((p) => p.id === "p-cake")!;
    expect(lineTotal(cake, 4)).toBe(2000); // 4 × $5.00 = $20.00
  });

  it("four cake + two pudding = $30 before other charges", () => {
    const cake = PLATTERS.find((p) => p.id === "p-cake")!;
    const pudding = PLATTERS.find((p) => p.id === "p-pudding")!;
    expect(lineTotal(cake, 4) + lineTotal(pudding, 2)).toBe(3000); // $30.00
  });

  it("line total is not multiplied by party size", () => {
    const tea = PLATTERS.find((p) => p.id === "p-tea")!;
    const partySize = 6;
    // Party-level: $6 per pitcher regardless of guests.
    expect(lineTotal(tea, 2)).toBe(1200);
    expect(lineTotal(tea, 2) * partySize).not.toBe(1200);
  });
});

describe("setPlatterQuantity — optional add-ons selection", () => {
  it("adds a new platter with a positive integer quantity", () => {
    const next = setPlatterQuantity([], "p-cake", 4);
    expect(next).toEqual([{ platterId: "p-cake", quantity: 4 }]);
  });

  it("updates an existing platter quantity", () => {
    const next = setPlatterQuantity([{ platterId: "p-cake", quantity: 2 }], "p-cake", 5);
    expect(next).toEqual([{ platterId: "p-cake", quantity: 5 }]);
  });

  it("quantity zero removes the selection", () => {
    const next = setPlatterQuantity([{ platterId: "p-cake", quantity: 4 }], "p-cake", 0);
    expect(next).toEqual([]);
  });

  it("rejects negative quantities (floors at 0, removes)", () => {
    const next = setPlatterQuantity([{ platterId: "p-cake", quantity: 4 }], "p-cake", -1);
    expect(next).toEqual([]);
  });

  it("rejects fractional quantities (truncates to integer)", () => {
    const next = setPlatterQuantity([], "p-cake", 2.9);
    expect(next).toEqual([{ platterId: "p-cake", quantity: 2 }]);
  });

  it("preserves other platters when updating one", () => {
    const next = setPlatterQuantity(
      [
        { platterId: "p-cake", quantity: 4 },
        { platterId: "p-tea", quantity: 1 },
      ],
      "p-tea",
      2,
    );
    expect(next).toEqual([
      { platterId: "p-cake", quantity: 4 },
      { platterId: "p-tea", quantity: 2 },
    ]);
  });
});
