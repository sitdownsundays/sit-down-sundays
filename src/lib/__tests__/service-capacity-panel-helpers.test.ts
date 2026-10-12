/**
 * Service capacity panel — focused tests for pure helpers.
 *
 * Mocked-boundary tests, NOT live PostgreSQL or rendered-interaction verification.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SENTINEL,
  capacityValueToSelection,
  selectionToCapacityValue,
  initializeSelection,
  hasActualChange,
  buildCapacitySavePayload,
} from "@/components/admin/service-capacity-helpers";
import type { ServiceCapacityOption } from "@/lib/sundays/service-capacity-options";
import type { SundayServiceDTO } from "@/lib/sundays/types";

const WHOLE_UUID = "44444444-4444-4444-8444-444444444444";

function makeService(overrides: Partial<SundayServiceDTO> = {}): SundayServiceDTO {
  return {
    id: "svc-1",
    date: "2026-11-15",
    label: "",
    status: "scheduled",
    spaceId: "space-1",
    onlineBookingLimit: null,
    capacityResourceId: null,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

const standaloneOptions: ServiceCapacityOption[] = [
  { capacityResourceId: null, mode: "default", totalCapacity: 950 },
];

const sectionOptions: ServiceCapacityOption[] = [
  { capacityResourceId: null, mode: "default", totalCapacity: 60 },
  { capacityResourceId: WHOLE_UUID, mode: "whole", totalCapacity: 120 },
];

describe("capacityValueToSelection", () => {
  it("converts null to the default sentinel", () => {
    expect(capacityValueToSelection(null)).toBe(DEFAULT_SENTINEL);
  });

  it("passes a UUID through unchanged", () => {
    expect(capacityValueToSelection(WHOLE_UUID)).toBe(WHOLE_UUID);
  });
});

describe("selectionToCapacityValue", () => {
  it("converts the default sentinel back to null", () => {
    expect(selectionToCapacityValue(DEFAULT_SENTINEL)).toBeNull();
  });

  it("passes a UUID through unchanged", () => {
    expect(selectionToCapacityValue(WHOLE_UUID)).toBe(WHOLE_UUID);
  });
});

describe("initializeSelection", () => {
  it("returns the default sentinel when saved value is null", () => {
    expect(initializeSelection(null, standaloneOptions)).toBe(DEFAULT_SENTINEL);
  });

  it("preserves a matching whole-parent UUID", () => {
    expect(initializeSelection(WHOLE_UUID, sectionOptions)).toBe(WHOLE_UUID);
  });

  it("returns null for an unknown saved UUID — does not silently convert to default", () => {
    const unknown = "55555555-5555-4555-8555-555555555555";
    expect(initializeSelection(unknown, sectionOptions)).toBeNull();
  });

  it("returns null for an unknown saved UUID with standalone options", () => {
    const unknown = "55555555-5555-4555-8555-555555555555";
    expect(initializeSelection(unknown, standaloneOptions)).toBeNull();
  });
});

describe("hasActualChange", () => {
  it("returns false when selection is null (no actionable change)", () => {
    expect(hasActualChange(null, null)).toBe(false);
    expect(hasActualChange(WHOLE_UUID, null)).toBe(false);
  });

  it("returns false when the selection matches the saved value", () => {
    expect(hasActualChange(null, DEFAULT_SENTINEL)).toBe(false);
    expect(hasActualChange(WHOLE_UUID, WHOLE_UUID)).toBe(false);
  });

  it("returns true when the selection differs from the saved value", () => {
    expect(hasActualChange(null, WHOLE_UUID)).toBe(true);
    expect(hasActualChange(WHOLE_UUID, DEFAULT_SENTINEL)).toBe(true);
  });
});

describe("buildCapacitySavePayload", () => {
  it("builds a payload with only id, expectedUpdatedAt, and capacityResourceId", () => {
    const svc = makeService({ capacityResourceId: null, updatedAt: "2026-10-01T12:00:00.123Z" });
    const payload = buildCapacitySavePayload(svc, DEFAULT_SENTINEL, standaloneOptions);
    expect(payload).not.toBeNull();
    expect(payload).toEqual({
      id: "svc-1",
      expectedUpdatedAt: "2026-10-01T12:00:00.123Z",
      capacityResourceId: null,
    });
  });

  it("preserves a whole-parent UUID in the payload", () => {
    const svc = makeService({ capacityResourceId: null });
    const payload = buildCapacitySavePayload(svc, WHOLE_UUID, sectionOptions);
    expect(payload).toEqual({
      id: "svc-1",
      expectedUpdatedAt: svc.updatedAt,
      capacityResourceId: WHOLE_UUID,
    });
  });

  it("returns null when selection is null", () => {
    const svc = makeService();
    expect(buildCapacitySavePayload(svc, null, standaloneOptions)).toBeNull();
  });

  it("returns null when no options are loaded", () => {
    const svc = makeService();
    expect(buildCapacitySavePayload(svc, DEFAULT_SENTINEL, [])).toBeNull();
  });

  it("returns null when the selection is not an offered option", () => {
    const svc = makeService();
    const unknown = "55555555-5555-4555-8555-555555555555";
    expect(buildCapacitySavePayload(svc, unknown, standaloneOptions)).toBeNull();
  });

  it("does not include spaceId, date, status, or other fields", () => {
    const svc = makeService();
    const payload = buildCapacitySavePayload(svc, DEFAULT_SENTINEL, standaloneOptions);
    expect(payload).not.toBeNull();
    const keys = Object.keys(payload!);
    expect(keys).toEqual(["id", "expectedUpdatedAt", "capacityResourceId"]);
  });
});
