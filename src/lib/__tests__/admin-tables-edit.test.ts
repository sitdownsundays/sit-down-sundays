import { describe, it, expect } from "vitest";
import {
  editFormFromTable,
  buildUpdatePayload,
  formHasChanges,
  validateEditForm,
  isConflict,
} from "@/components/admin/admin-tables-edit-helpers";
import type { DiningTableDTO } from "@/lib/sundays/types";

function makeTable(overrides: Partial<DiningTableDTO> = {}): DiningTableDTO {
  return {
    id: "t1",
    spaceId: "room-1",
    label: "A1",
    seats: 4,
    zone: "",
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("admin tables edit helpers", () => {
  // ==========================================================================
  // editFormFromTable
  // ==========================================================================
  describe("editFormFromTable", () => {
    it("extracts the editable fields from a loaded table", () => {
      const form = editFormFromTable(
        makeTable({ label: "B2", seats: 8, zone: "North", isActive: false }),
      );
      expect(form).toEqual({ label: "B2", seats: 8, zone: "North", isActive: false });
    });

    it("does not include room or id in the form", () => {
      const form = editFormFromTable(makeTable());
      expect(form).not.toHaveProperty("id");
      expect(form).not.toHaveProperty("spaceId");
    });
  });

  // ==========================================================================
  // buildUpdatePayload — preserves ID and expectedUpdatedAt
  // ==========================================================================
  describe("buildUpdatePayload", () => {
    it("preserves the table ID and original updatedAt as expectedUpdatedAt", () => {
      const table = makeTable({ updatedAt: "2026-06-01T12:00:00.000Z" });
      const form = editFormFromTable(table);
      const payload = buildUpdatePayload(table, { ...form, label: "C3" });
      expect(payload.id).toBe("t1");
      expect(payload.expectedUpdatedAt).toBe("2026-06-01T12:00:00.000Z");
    });

    it("includes only changed fields", () => {
      const table = makeTable({ label: "A1", seats: 4, zone: "", isActive: true });
      const payload = buildUpdatePayload(table, {
        label: "A1",
        seats: 8,
        zone: "",
        isActive: true,
      });
      expect(payload.label).toBeUndefined();
      expect(payload.seats).toBe(8);
      expect(payload.zone).toBeUndefined();
      expect(payload.isActive).toBeUndefined();
    });

    it("trims label and zone before comparing", () => {
      const table = makeTable({ label: "A1", zone: "Main" });
      const payload = buildUpdatePayload(table, {
        label: "  A1  ",
        seats: 4,
        zone: "  Main  ",
        isActive: true,
      });
      // Trimmed values match the stored values, so no changes included.
      expect(payload.label).toBeUndefined();
      expect(payload.zone).toBeUndefined();
    });

    it("detects an active/inactive status change", () => {
      const table = makeTable({ isActive: true });
      const payload = buildUpdatePayload(table, {
        label: "A1",
        seats: 4,
        zone: "",
        isActive: false,
      });
      expect(payload.isActive).toBe(false);
    });
  });

  // ==========================================================================
  // formHasChanges
  // ==========================================================================
  describe("formHasChanges", () => {
    it("returns false when nothing changed", () => {
      const table = makeTable();
      expect(formHasChanges(table, editFormFromTable(table))).toBe(false);
    });

    it("returns true when at least one field differs", () => {
      const table = makeTable();
      expect(
        formHasChanges(table, {
          label: "A1",
          seats: 6,
          zone: "",
          isActive: true,
        }),
      ).toBe(true);
    });
  });

  // ==========================================================================
  // validateEditForm
  // ==========================================================================
  describe("validateEditForm", () => {
    it("returns null for a valid form", () => {
      expect(validateEditForm({ label: "A1", seats: 4, zone: "", isActive: true })).toBeNull();
    });

    it("rejects an empty label", () => {
      expect(validateEditForm({ label: "  ", seats: 4, zone: "", isActive: true })).not.toBeNull();
    });

    it("rejects an over-length label", () => {
      expect(
        validateEditForm({ label: "x".repeat(121), seats: 4, zone: "", isActive: true }),
      ).not.toBeNull();
    });

    it("rejects an over-length zone", () => {
      expect(
        validateEditForm({
          label: "A1",
          seats: 4,
          zone: "z".repeat(121),
          isActive: true,
        }),
      ).not.toBeNull();
    });
  });

  // ==========================================================================
  // isConflict — conflict does not overwrite the saved record
  // ==========================================================================
  describe("isConflict", () => {
    it("returns true when result.conflict is true", () => {
      expect(isConflict({ success: false, conflict: true, error: "stale" })).toBe(true);
    });

    it("returns false for a generic non-conflict failure", () => {
      expect(isConflict({ success: false, error: "db down" })).toBe(false);
    });

    it("returns false for a successful result", () => {
      expect(isConflict({ success: true, data: makeTable() })).toBe(false);
    });
  });

  // ==========================================================================
  // Soft-disable / reactivation round-trip
  // ==========================================================================
  describe("soft-disable and reactivation", () => {
    it("can build a payload that disables an active table", () => {
      const table = makeTable({ isActive: true });
      const payload = buildUpdatePayload(table, {
        label: "A1",
        seats: 4,
        zone: "",
        isActive: false,
      });
      expect(payload.isActive).toBe(false);
    });

    it("can build a payload that reactivates an inactive table", () => {
      const table = makeTable({ isActive: false });
      const payload = buildUpdatePayload(table, {
        label: "A1",
        seats: 4,
        zone: "",
        isActive: true,
      });
      expect(payload.isActive).toBe(true);
    });
  });
});
