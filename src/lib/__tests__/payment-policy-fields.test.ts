import { describe, it, expect } from "vitest";
import { MockSundaysRepository } from "@/lib/server/sundays-mock.server";
import { updatePaymentPolicySchema } from "@/lib/sundays/schema";
import type { PaymentPolicyDTO, UpdatePaymentPolicyInput } from "@/lib/sundays/types";

const actor = "staff-actor-1";

/** A complete, valid base update input (all three core fields). */
function baseInput(expectedUpdatedAt: string): UpdatePaymentPolicyInput {
  return {
    expectedUpdatedAt,
    depositPercent: 50,
    defaultBalanceDeadlineHours: 72,
    restaurantTimezone: "America/Chicago",
  };
}

describe("Payment policy — three new tax/gratuity fields", () => {
  // ==========================================================================
  // DTO default exposure
  // ==========================================================================
  describe("getPaymentPolicy defaults", () => {
    it("exposes the three new fields as null when not configured", async () => {
      const repo = new MockSundaysRepository();
      const policy = await repo.getPaymentPolicy();
      expect(policy.taxRateBasisPoints).toBeNull();
      expect(policy.gratuityRateBasisPoints).toBeNull();
      expect(policy.taxOnGratuity).toBeNull();
    });

    it("preserves existing core fields (deposit, deadline, timezone)", async () => {
      const repo = new MockSundaysRepository();
      const policy = await repo.getPaymentPolicy();
      expect(policy.depositPercent).toBe(50);
      expect(policy.defaultBalanceDeadlineHours).toBe(72);
      expect(policy.restaurantTimezone).toBeNull();
    });
  });

  // ==========================================================================
  // Update semantics: omitted vs null vs supplied values
  // ==========================================================================
  describe("updatePaymentPolicy field semantics", () => {
    it("omitted fields leave existing values unchanged", async () => {
      const repo = new MockSundaysRepository();
      const initial = await repo.getPaymentPolicy();
      // Configure the fields first.
      const configured = await repo.updatePaymentPolicy(actor, {
        ...baseInput(initial.updatedAt),
        taxRateBasisPoints: 1000,
        gratuityRateBasisPoints: 1800,
        taxOnGratuity: true,
      });
      expect(configured.success).toBe(true);

      // Update only core fields, omitting the three new ones.
      const after = await repo.updatePaymentPolicy(actor, {
        ...baseInput(configured.data!.updatedAt),
        depositPercent: 60,
      });
      expect(after.success).toBe(true);
      expect(after.data!.taxRateBasisPoints).toBe(1000);
      expect(after.data!.gratuityRateBasisPoints).toBe(1800);
      expect(after.data!.taxOnGratuity).toBe(true);
    });

    it("explicit null clears configured values to 'not configured'", async () => {
      const repo = new MockSundaysRepository();
      const initial = await repo.getPaymentPolicy();
      const configured = await repo.updatePaymentPolicy(actor, {
        ...baseInput(initial.updatedAt),
        taxRateBasisPoints: 1000,
        gratuityRateBasisPoints: 1800,
        taxOnGratuity: true,
      });
      expect(configured.success).toBe(true);

      const cleared = await repo.updatePaymentPolicy(actor, {
        ...baseInput(configured.data!.updatedAt),
        taxRateBasisPoints: null,
        gratuityRateBasisPoints: null,
        taxOnGratuity: null,
      });
      expect(cleared.success).toBe(true);
      expect(cleared.data!.taxRateBasisPoints).toBeNull();
      expect(cleared.data!.gratuityRateBasisPoints).toBeNull();
      expect(cleared.data!.taxOnGratuity).toBeNull();
    });

    it("preserves supplied zero and false exactly", async () => {
      const repo = new MockSundaysRepository();
      const initial = await repo.getPaymentPolicy();
      const result = await repo.updatePaymentPolicy(actor, {
        ...baseInput(initial.updatedAt),
        taxRateBasisPoints: 0,
        gratuityRateBasisPoints: 0,
        taxOnGratuity: false,
      });
      expect(result.success).toBe(true);
      expect(result.data!.taxRateBasisPoints).toBe(0);
      expect(result.data!.gratuityRateBasisPoints).toBe(0);
      expect(result.data!.taxOnGratuity).toBe(false);
    });

    it("sets updatedBy from the trusted actor", async () => {
      const repo = new MockSundaysRepository();
      const initial = await repo.getPaymentPolicy();
      const result = await repo.updatePaymentPolicy("manager-2", {
        ...baseInput(initial.updatedAt),
        taxRateBasisPoints: 1000,
      });
      expect(result.success).toBe(true);
      expect(result.data!.updatedBy).toBe("manager-2");
    });

    it("rejects a stale timestamp with a conflict and does not mutate", async () => {
      const repo = new MockSundaysRepository();
      const initial = await repo.getPaymentPolicy();
      const configured = await repo.updatePaymentPolicy(actor, {
        ...baseInput(initial.updatedAt),
        taxRateBasisPoints: 1000,
      });
      expect(configured.success).toBe(true);

      // Stale timestamp (the pre-update value).
      const stale = await repo.updatePaymentPolicy(actor, {
        ...baseInput(initial.updatedAt),
        taxRateBasisPoints: 2000,
      });
      expect(stale.success).toBe(false);
      expect(stale.conflict).toBe(true);

      // Stored value unchanged.
      const current = await repo.getPaymentPolicy();
      expect(current.taxRateBasisPoints).toBe(1000);
    });
  });

  // ==========================================================================
  // Schema validation
  // ==========================================================================
  describe("updatePaymentPolicySchema validation", () => {
    it("accepts valid supplied values", () => {
      const parsed = updatePaymentPolicySchema.parse({
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        depositPercent: 50,
        defaultBalanceDeadlineHours: 72,
        restaurantTimezone: "America/Chicago",
        taxRateBasisPoints: 1000,
        gratuityRateBasisPoints: 1800,
        taxOnGratuity: true,
      });
      expect(parsed.taxRateBasisPoints).toBe(1000);
      expect(parsed.gratuityRateBasisPoints).toBe(1800);
      expect(parsed.taxOnGratuity).toBe(true);
    });

    it("accepts zero and false as valid supplied values", () => {
      const parsed = updatePaymentPolicySchema.parse({
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        depositPercent: 50,
        defaultBalanceDeadlineHours: 72,
        restaurantTimezone: null,
        taxRateBasisPoints: 0,
        gratuityRateBasisPoints: 0,
        taxOnGratuity: false,
      });
      expect(parsed.taxRateBasisPoints).toBe(0);
      expect(parsed.gratuityRateBasisPoints).toBe(0);
      expect(parsed.taxOnGratuity).toBe(false);
    });

    it("accepts explicit null to clear", () => {
      const parsed = updatePaymentPolicySchema.parse({
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        depositPercent: 50,
        defaultBalanceDeadlineHours: 72,
        restaurantTimezone: null,
        taxRateBasisPoints: null,
        gratuityRateBasisPoints: null,
        taxOnGratuity: null,
      });
      expect(parsed.taxRateBasisPoints).toBeNull();
      expect(parsed.gratuityRateBasisPoints).toBeNull();
      expect(parsed.taxOnGratuity).toBeNull();
    });

    it("allows the three new fields to be omitted entirely", () => {
      const parsed = updatePaymentPolicySchema.parse({
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        depositPercent: 50,
        defaultBalanceDeadlineHours: 72,
        restaurantTimezone: null,
      });
      expect(parsed.taxRateBasisPoints).toBeUndefined();
      expect(parsed.gratuityRateBasisPoints).toBeUndefined();
      expect(parsed.taxOnGratuity).toBeUndefined();
    });

    it("rejects non-integer rates", () => {
      expect(() =>
        updatePaymentPolicySchema.parse({
          expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
          depositPercent: 50,
          defaultBalanceDeadlineHours: 72,
          restaurantTimezone: null,
          taxRateBasisPoints: 10.5,
        }),
      ).toThrow();
    });

    it("rejects out-of-range rates", () => {
      expect(() =>
        updatePaymentPolicySchema.parse({
          expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
          depositPercent: 50,
          defaultBalanceDeadlineHours: 72,
          restaurantTimezone: null,
          taxRateBasisPoints: 10001,
        }),
      ).toThrow();
      expect(() =>
        updatePaymentPolicySchema.parse({
          expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
          depositPercent: 50,
          defaultBalanceDeadlineHours: 72,
          restaurantTimezone: null,
          gratuityRateBasisPoints: -1,
        }),
      ).toThrow();
    });

    it("rejects non-boolean taxOnGratuity", () => {
      expect(() =>
        updatePaymentPolicySchema.parse({
          expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
          depositPercent: 50,
          defaultBalanceDeadlineHours: 72,
          restaurantTimezone: null,
          taxOnGratuity: "yes",
        }),
      ).toThrow();
    });
  });

  // ==========================================================================
  // Round-trip: configure → read back
  // ==========================================================================
  describe("round-trip persistence", () => {
    it("configured values survive a read after update", async () => {
      const repo = new MockSundaysRepository();
      const initial = await repo.getPaymentPolicy();
      const configured = await repo.updatePaymentPolicy(actor, {
        ...baseInput(initial.updatedAt),
        taxRateBasisPoints: 1000,
        gratuityRateBasisPoints: 1800,
        taxOnGratuity: true,
      });
      expect(configured.success).toBe(true);

      const reloaded = await repo.getPaymentPolicy();
      expect(reloaded.taxRateBasisPoints).toBe(1000);
      expect(reloaded.gratuityRateBasisPoints).toBe(1800);
      expect(reloaded.taxOnGratuity).toBe(true);
      expect(reloaded.depositPercent).toBe(50);
      expect(reloaded.defaultBalanceDeadlineHours).toBe(72);
      expect(reloaded.restaurantTimezone).toBe("America/Chicago");
    });

    it("a full PaymentPolicyDTO carries all three new fields", async () => {
      const repo = new MockSundaysRepository();
      const initial = await repo.getPaymentPolicy();
      const result = await repo.updatePaymentPolicy(actor, {
        ...baseInput(initial.updatedAt),
        taxRateBasisPoints: 500,
      });
      const dto: PaymentPolicyDTO = result.data!;
      expect(dto).toHaveProperty("taxRateBasisPoints", 500);
      expect(dto).toHaveProperty("gratuityRateBasisPoints", null);
      expect(dto).toHaveProperty("taxOnGratuity", null);
    });
  });
});
