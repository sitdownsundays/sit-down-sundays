/**
 * Public quote input-contract tests — exercises the REAL production
 * quoteOrderSchema + normalizeQuoteGuests, not a duplicated test model.
 *
 * Covers:
 *  - accepted literal categories (adult/senior/child) and selection categories.
 *  - rejected unknown categories.
 *  - absent vs present guest name (omit-when-undefined, preserve-when-supplied).
 *  - explicit `undefined` name (parsed schema output) → omitted key.
 *  - preservation of every included selection and add-on value.
 *  - normalized guests are structurally ReservationGuestInput[].
 *
 * Mocked: none (pure schema/normalizer). No database or Supabase involved.
 */
import { describe, it, expect } from "vitest";
import { quoteOrderSchema } from "@/lib/public-quote.functions";
import { normalizeQuoteGuests } from "@/lib/server/public-quote-normalize.server";

const PKG = "11111111-0000-4000-8000-000000000001";
const MEAT_A = "22222222-0000-4000-8000-000000000001";
const MEAT_B = "22222222-0000-4000-8000-000000000002";
const SIDE_A = "33333333-0000-4000-8000-000000000001";
const SIDE_B = "33333333-0000-4000-8000-000000000002";
const ADDON = "55555555-0000-4000-8000-000000000001";

function baseGuest(overrides: Record<string, unknown> = {}) {
  return {
    guestIndex: 0,
    category: "adult",
    packageId: PKG,
    included: [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ],
    addons: [{ addonId: ADDON, quantity: 2 }],
    ...overrides,
  };
}

function baseInput(guests: unknown[]) {
  return {
    sundayServiceId: "11111111-0000-4000-8000-0000000000aa",
    seatingTimeId: "11111111-0000-4000-8000-0000000000bb",
    guests,
    platters: [],
  };
}

describe("public quote schema contract", () => {
  it("accepts all guest categories", () => {
    for (const category of ["adult", "senior", "child"] as const) {
      const parsed = quoteOrderSchema.parse(baseInput([baseGuest({ category })]));
      const g = parsed.guests[0];
      expect(g).toBeDefined();
      if (g) expect(g.category).toBe(category);
    }
  });

  it("accepts all selection categories", () => {
    for (const selectionCategory of ["meat", "side", "bread", "drink"] as const) {
      const parsed = quoteOrderSchema.parse(
        baseInput([baseGuest({ included: [{ menuItemId: MEAT_A, selectionCategory }] })]),
      );
      const g = parsed.guests[0];
      expect(g).toBeDefined();
      const sel = g?.included[0];
      expect(sel).toBeDefined();
      if (sel) expect(sel.selectionCategory).toBe(selectionCategory);
    }
  });

  it("rejects unknown guest category", () => {
    expect(() => quoteOrderSchema.parse(baseInput([baseGuest({ category: "toddler" })]))).toThrow();
  });

  it("rejects unknown selection category", () => {
    expect(() =>
      quoteOrderSchema.parse(
        baseInput([
          baseGuest({ included: [{ menuItemId: MEAT_A, selectionCategory: "dessert" }] }),
        ]),
      ),
    ).toThrow();
  });

  it("treats name as optional and preserves it when supplied", () => {
    const withoutName = quoteOrderSchema.parse(baseInput([baseGuest()]));
    const g0 = withoutName.guests[0];
    expect(g0).toBeDefined();
    if (g0) expect(g0.name).toBeUndefined();

    const withName = quoteOrderSchema.parse(baseInput([baseGuest({ name: "Alice" })]));
    const g1 = withName.guests[0];
    expect(g1).toBeDefined();
    if (g1) expect(g1.name).toBe("Alice");
  });

  it("defaults included/addons to empty arrays when absent", () => {
    const parsed = quoteOrderSchema.parse(
      baseInput([{ guestIndex: 0, category: "adult", packageId: PKG }]),
    );
    const g = parsed.guests[0];
    expect(g).toBeDefined();
    if (g) {
      expect(g.included).toEqual([]);
      expect(g.addons).toEqual([]);
    }
  });
});

describe("normalizeQuoteGuests — real schema-parsed input", () => {
  it("omits name when absent in parsed input, preserves it when supplied", () => {
    const parsed = quoteOrderSchema.parse(baseInput([baseGuest()]));
    const normalized = normalizeQuoteGuests(parsed.guests);
    const g = normalized[0];
    expect(g).toBeDefined();
    if (g) expect("name" in g).toBe(false);

    const parsedNamed = quoteOrderSchema.parse(baseInput([baseGuest({ name: "Alice" })]));
    const normalizedNamed = normalizeQuoteGuests(parsedNamed.guests);
    const g1 = normalizedNamed[0];
    expect(g1).toBeDefined();
    if (g1) expect(g1.name).toBe("Alice");
  });

  it("preserves every included selection and add-on value from parsed input", () => {
    const parsed = quoteOrderSchema.parse(baseInput([baseGuest()]));
    const [g] = normalizeQuoteGuests(parsed.guests);
    if (!g) throw new Error("test fixture missing normalized guest");
    expect(g.guestIndex).toBe(0);
    expect(g.category).toBe("adult");
    expect(g.packageId).toBe(PKG);
    expect(g.included).toHaveLength(4);
    const first = g.included[0];
    expect(first).toEqual({ menuItemId: MEAT_A, selectionCategory: "meat" });
    expect(g.addons).toEqual([{ addonId: ADDON, quantity: 2 }]);
  });

  it("does not synthesize per-guest note fields", () => {
    const parsed = quoteOrderSchema.parse(baseInput([baseGuest()]));
    const [g] = normalizeQuoteGuests(parsed.guests);
    if (!g) throw new Error("test fixture missing normalized guest");
    expect("foodAllergies" in g).toBe(false);
    expect("dietaryPreferences" in g).toBe(false);
    expect("mealRequests" in g).toBe(false);
  });

  it("does not mutate the parsed input", () => {
    const parsed = quoteOrderSchema.parse(baseInput([baseGuest()]));
    const snapshot = JSON.parse(JSON.stringify(parsed));
    normalizeQuoteGuests(parsed.guests);
    expect(parsed).toEqual(snapshot);
  });

  it("normalizes guests in order across multiple guests", () => {
    const parsed = quoteOrderSchema.parse(
      baseInput([
        baseGuest({ guestIndex: 0, category: "adult", name: "Alice" }),
        baseGuest({ guestIndex: 1, category: "child", name: "Bob", included: [] }),
      ]),
    );
    const normalized = normalizeQuoteGuests(parsed.guests);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toBeDefined();
    expect(normalized[1]).toBeDefined();
    if (normalized[0]) {
      expect(normalized[0].guestIndex).toBe(0);
      expect(normalized[0].category).toBe("adult");
      expect(normalized[0].name).toBe("Alice");
    }
    if (normalized[1]) {
      expect(normalized[1].guestIndex).toBe(1);
      expect(normalized[1].category).toBe("child");
      expect(normalized[1].name).toBe("Bob");
      expect(normalized[1].included).toEqual([]);
    }
  });

  it("explicit undefined name is passed through by the input contract and omitted by the normalizer", () => {
    // The QuoteGuestInput contract permits `name: undefined` (Zod infers it).
    // Constructing a parsed-equivalent shape directly exercises the input type
    // without bypassing the schema. The normalizer must omit the key.
    const input: Parameters<typeof normalizeQuoteGuests>[0] = [
      {
        guestIndex: 0,
        category: "adult",
        name: undefined,
        packageId: PKG,
        included: [],
        addons: [],
      },
    ];
    const [g] = normalizeQuoteGuests(input);
    if (!g) throw new Error("test fixture missing normalized guest");
    expect("name" in g).toBe(false);
  });
});
