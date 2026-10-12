/**
 * Create-service dialog — focused tests for the pure capacity helpers used by
 * the create flow.
 *
 * Mocked-boundary tests, NOT live PostgreSQL or rendered-interaction verification.
 * The dialog's capacity-loading, stale-response guards, and callback wiring are
 * source-inspected; these tests exercise the reusable helpers the dialog
 * imports from service-capacity-helpers.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SENTINEL,
  selectionToCapacityValue,
} from "@/components/admin/service-capacity-helpers";
import type { CreateServiceInput } from "@/components/admin/sundays-create-service-dialog";
import type { ServiceCapacityOption } from "@/lib/sundays/service-capacity-options";

const WHOLE_UUID = "44444444-4444-4444-8444-444444444444";
const WHOLE_UUID_B = "66666666-6666-4666-8666-666666666666";

const standaloneOptions: ServiceCapacityOption[] = [
  { capacityResourceId: null, mode: "default", totalCapacity: 950 },
];

const sectionOptions: ServiceCapacityOption[] = [
  { capacityResourceId: null, mode: "default", totalCapacity: 60 },
  { capacityResourceId: WHOLE_UUID, mode: "whole", totalCapacity: 120 },
];

/**
 * Mirror of the dialog's buildCreateInput: maps a selection + loaded options to
 * the CreateServiceInput.capacityResourceId field, using the same helper the
 * production dialog imports.
 */
function buildCreateInput(
  selection: string | null,
  options: ServiceCapacityOption[],
): Pick<CreateServiceInput, "capacityResourceId"> {
  if (selection === null) throw new Error("Missing selection");
  const value = selectionToCapacityValue(selection);
  const valid = options.some((opt) => opt.capacityResourceId === value);
  if (!valid) throw new Error("Invalid selection for loaded options");
  return { capacityResourceId: value };
}

describe("create-service capacity: default choice → null", () => {
  it("produces capacityResourceId:null for the default sentinel", () => {
    const result = buildCreateInput(DEFAULT_SENTINEL, standaloneOptions);
    expect(result.capacityResourceId).toBeNull();
  });

  it("produces capacityResourceId:null for the default sentinel with section options", () => {
    const result = buildCreateInput(DEFAULT_SENTINEL, sectionOptions);
    expect(result.capacityResourceId).toBeNull();
  });
});

describe("create-service capacity: whole-room choice preserves UUID", () => {
  it("preserves the whole-parent UUID", () => {
    const result = buildCreateInput(WHOLE_UUID, sectionOptions);
    expect(result.capacityResourceId).toBe(WHOLE_UUID);
  });

  it("does not produce null for a whole-room UUID", () => {
    const result = buildCreateInput(WHOLE_UUID, sectionOptions);
    expect(result.capacityResourceId).not.toBeNull();
  });
});

describe("create-service capacity: missing/invalid choices block submission", () => {
  it("rejects a null selection", () => {
    expect(() => buildCreateInput(null, standaloneOptions)).toThrow("Missing selection");
  });

  it("rejects a selection not in loaded options", () => {
    expect(() => buildCreateInput(WHOLE_UUID_B, standaloneOptions)).toThrow(
      "Invalid selection for loaded options",
    );
  });

  it("rejects a whole UUID from room A when only standalone options are loaded", () => {
    expect(() => buildCreateInput(WHOLE_UUID, standaloneOptions)).toThrow(
      "Invalid selection for loaded options",
    );
  });

  it("rejects an unknown UUID even when section options include a whole parent", () => {
    const unknown = "55555555-5555-4555-8555-555555555555";
    expect(() => buildCreateInput(unknown, sectionOptions)).toThrow(
      "Invalid selection for loaded options",
    );
  });
});

describe("create-service capacity: room change invalidates old choice", () => {
  it("a whole UUID valid for room A is invalid when only standalone options are loaded for room B", () => {
    expect(() => buildCreateInput(WHOLE_UUID, standaloneOptions)).toThrow(
      "Invalid selection for loaded options",
    );
  });

  it("the default sentinel remains valid across room changes (null is always offered)", () => {
    expect(() => buildCreateInput(DEFAULT_SENTINEL, standaloneOptions)).not.toThrow();
    expect(() => buildCreateInput(DEFAULT_SENTINEL, sectionOptions)).not.toThrow();
  });
});

describe("create-service capacity: payload preserves existing form values", () => {
  it("builds a complete CreateServiceInput with capacity + form fields", () => {
    const input: CreateServiceInput = {
      date: "2026-11-15",
      label: "Thanksgiving",
      spaceId: "space-1",
      status: "scheduled",
      onlineBookingLimit: 12,
      ...buildCreateInput(DEFAULT_SENTINEL, standaloneOptions),
    };
    expect(input).toEqual({
      date: "2026-11-15",
      label: "Thanksgiving",
      spaceId: "space-1",
      status: "scheduled",
      onlineBookingLimit: 12,
      capacityResourceId: null,
    });
  });

  it("preserves a whole-parent UUID through the full payload", () => {
    const input: CreateServiceInput = {
      date: "2026-11-15",
      label: "",
      spaceId: "space-2",
      status: "scheduled",
      onlineBookingLimit: null,
      ...buildCreateInput(WHOLE_UUID, sectionOptions),
    };
    expect(input.capacityResourceId).toBe(WHOLE_UUID);
    expect(input.spaceId).toBe("space-2");
    expect(input.onlineBookingLimit).toBeNull();
  });
});
