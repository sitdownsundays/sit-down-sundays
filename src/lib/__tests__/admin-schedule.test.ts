/**
 * Admin Menus — publication schedule UX & validation tests.
 *
 * Behavioral tests for the split date/time ScheduleField form layer:
 * unscheduled draft creation, incomplete boundaries, clearing, valid
 * scheduling, invalid ordering, and existing-timestamp round trips.
 *
 * These exercise the form helpers (validateForm, isoToScheduleBoundary,
 * scheduleBoundaryToIso) and the menu create/edit server-function payloads
 * through the mock repository — the same contract the UI delegates to.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";
import { __getMockAuthRepository } from "@/lib/server/auth-repository.server";
import {
  emptyFormValues,
  isoToScheduleBoundary,
  scheduleBoundaryToIso,
  validateForm,
  isBoundaryIncomplete,
  browserTimezoneLabel,
} from "@/components/admin/menu-form-helpers";
import { menuInputSchema } from "@/lib/menu/schema";
import type { RoleKey } from "@/lib/domain/types";

const BASE_TIME = "2025-09-01T10:00:00Z";

function authenticateAs(role: RoleKey): void {
  __getMockAuthRepository().__seedMockSession(role);
}

beforeEach(() => {
  process.env.APP_DATA_MODE = "mock";
  __resetMockMenuRepository();
  try {
    void __getMockAuthRepository().signout(false);
  } catch {
    /* first call: no instance yet */
  }
});

/* ----------------------- Boundary conversion ----------------------- */

describe("schedule boundary conversion", () => {
  it("round-trips an ISO timestamp through split boundary and back", () => {
    const iso = "2025-10-01T15:30:00.000Z";
    const boundary = isoToScheduleBoundary(iso);
    expect(boundary.date).not.toBe("");
    expect(boundary.time).not.toBe("");
    expect(scheduleBoundaryToIso(boundary)).toBe(iso);
  });

  it("treats a null timestamp as an empty boundary", () => {
    expect(isoToScheduleBoundary(null)).toEqual({ date: "", time: "" });
  });

  it("treats an invalid timestamp as an empty boundary", () => {
    expect(isoToScheduleBoundary("not-a-date")).toEqual({ date: "", time: "" });
  });

  it("converts an empty boundary to null", () => {
    expect(scheduleBoundaryToIso({ date: "", time: "" })).toBeNull();
  });

  it("converts an incomplete boundary (date only) to null without discarding the input", () => {
    const b = { date: "2025-10-01", time: "" };
    expect(scheduleBoundaryToIso(b)).toBeNull();
    expect(isBoundaryIncomplete(b)).toBe(true);
  });

  it("converts an incomplete boundary (time only) to null without discarding the input", () => {
    const b = { date: "", time: "15:30" };
    expect(scheduleBoundaryToIso(b)).toBeNull();
    expect(isBoundaryIncomplete(b)).toBe(true);
  });

  it("detects a complete boundary as not incomplete", () => {
    expect(isBoundaryIncomplete({ date: "2025-10-01", time: "15:30" })).toBe(false);
  });
});

/* ----------------------- Form validation ----------------------- */

describe("schedule form validation", () => {
  it("accepts a draft with both boundaries unset", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: { date: "", time: "" },
      unpublishAt: { date: "", time: "" },
    });
    expect(errors.publishAt).toBeUndefined();
    expect(errors.unpublishAt).toBeUndefined();
  });

  it("rejects an incomplete publish boundary (date without time)", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: { date: "2025-10-01", time: "" },
      unpublishAt: { date: "", time: "" },
    });
    expect(errors.publishAt).toBeTruthy();
    expect(errors.publishAt).toMatch(/date and a time|clear/i);
  });

  it("rejects an incomplete unpublish boundary (time without date)", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: { date: "", time: "" },
      unpublishAt: { date: "", time: "15:30" },
    });
    expect(errors.unpublishAt).toBeTruthy();
  });

  it("accepts a valid schedule window", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: { date: "2025-09-01", time: "10:00" },
      unpublishAt: { date: "2025-10-01", time: "10:00" },
    });
    expect(errors.publishAt).toBeUndefined();
    expect(errors.unpublishAt).toBeUndefined();
  });

  it("rejects an unpublish earlier than the publish", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: { date: "2025-10-01", time: "10:00" },
      unpublishAt: { date: "2025-09-01", time: "10:00" },
    });
    expect(errors.unpublishAt).toBeTruthy();
    expect(errors.unpublishAt).toMatch(/later than/i);
  });

  it("allows only the publish boundary to be set", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: { date: "2025-09-01", time: "10:00" },
      unpublishAt: { date: "", time: "" },
    });
    expect(errors.publishAt).toBeUndefined();
    expect(errors.unpublishAt).toBeUndefined();
  });

  it("allows only the unpublish boundary to be set", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: { date: "", time: "" },
      unpublishAt: { date: "2025-12-01", time: "10:00" },
    });
    expect(errors.publishAt).toBeUndefined();
    expect(errors.unpublishAt).toBeUndefined();
  });
});

/* ----------------------- Repository round trips ----------------------- */

describe("schedule persistence round trips (mock repository)", () => {
  it("creates an unscheduled draft and reads it back with null boundaries", async () => {
    authenticateAs("administrator");
    const repo = getMenuRepository();
    const res = await repo.createMenu("administrator", "actor-1", {
      name: "Unscheduled",
      slug: "unscheduled",
      description: "",
      displayOrder: 0,
      publishAt: null,
      unpublishAt: null,
    });
    expect(res.ok).toBe(true);
    const menus = await repo.listAllMenus("administrator");
    expect(menus[0].publishAt).toBeNull();
    expect(menus[0].unpublishAt).toBeNull();
    expect(menus[0].status).toBe("draft");
  });

  it("creates a scheduled draft and reads the timestamps back", async () => {
    authenticateAs("administrator");
    const repo = getMenuRepository();
    const publishIso = "2025-09-01T10:00:00.000Z";
    const unpublishIso = "2025-10-01T10:00:00.000Z";
    const res = await repo.createMenu("administrator", "actor-1", {
      name: "Scheduled",
      slug: "scheduled",
      description: "",
      displayOrder: 0,
      publishAt: publishIso,
      unpublishAt: unpublishIso,
    });
    expect(res.ok).toBe(true);
    const menus = await repo.listAllMenus("administrator");
    expect(menus[0].publishAt).toBe(publishIso);
    expect(menus[0].unpublishAt).toBe(unpublishIso);
    // Scheduling does not change draft status.
    expect(menus[0].status).toBe("draft");
  });

  it("round-trips an existing schedule through edit form values and back", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = crypto.randomUUID();
    const publishIso = "2025-09-01T10:00:00.000Z";
    const unpublishIso = "2025-10-01T10:00:00.000Z";
    repo.__seed(
      [
        {
          id: menuId,
          name: "Existing",
          slug: "existing",
          description: "",
          status: "draft",
          displayOrder: 0,
          publishAt: publishIso,
          unpublishAt: unpublishIso,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
      [],
      [],
    );
    authenticateAs("administrator");
    const r = getMenuRepository();
    const detail = await r.getMenuDetail("administrator", menuId);

    // Simulate menuToFormValues + scheduleBoundaryToIso (the edit submit path).
    const pubBoundary = isoToScheduleBoundary(detail!.publishAt);
    const unpubBoundary = isoToScheduleBoundary(detail!.unpublishAt);
    expect(scheduleBoundaryToIso(pubBoundary)).toBe(publishIso);
    expect(scheduleBoundaryToIso(unpubBoundary)).toBe(unpublishIso);
  });

  it("clearing a boundary sends null and persists null", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = crypto.randomUUID();
    repo.__seed(
      [
        {
          id: menuId,
          name: "Clear Me",
          slug: "clear-me",
          description: "",
          status: "draft",
          displayOrder: 0,
          publishAt: "2025-09-01T10:00:00.000Z",
          unpublishAt: "2025-10-01T10:00:00.000Z",
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
      [],
      [],
    );
    authenticateAs("administrator");
    const r = getMenuRepository();
    const detail = await r.getMenuDetail("administrator", menuId);
    const res = await r.updateMenu(
      "administrator",
      "actor-1",
      menuId,
      { publishAt: null, unpublishAt: null },
      detail!.updatedAt,
    );
    expect(res.ok).toBe(true);
    const after = await r.getMenuDetail("administrator", menuId);
    expect(after?.publishAt).toBeNull();
    expect(after?.unpublishAt).toBeNull();
  });
});

/* ----------------------- Schema / server boundary ----------------------- */

describe("schedule schema boundary", () => {
  it("the create schema accepts null schedule boundaries", () => {
    expect(() =>
      menuInputSchema.parse({
        name: "Menu",
        slug: "m",
        publishAt: null,
        unpublishAt: null,
      }),
    ).not.toThrow();
  });

  it("the create schema accepts ISO schedule boundaries", () => {
    expect(() =>
      menuInputSchema.parse({
        name: "Menu",
        slug: "m",
        publishAt: "2025-09-01T10:00:00.000Z",
        unpublishAt: "2025-10-01T10:00:00.000Z",
      }),
    ).not.toThrow();
  });
});

/* ----------------------- Timezone label ----------------------- */

describe("timezone label", () => {
  it("returns a non-empty timezone label", () => {
    const label = browserTimezoneLabel();
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
  });
});
