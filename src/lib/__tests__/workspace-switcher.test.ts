import { describe, it, expect } from "vitest";
import {
  visibleWorkspaces,
  hasInternalWorkspace,
  WORKSPACES,
  type WorkspaceArea,
} from "@/components/layout/workspace-switcher";
import type { RoleKey } from "@/lib/domain/types";

describe("workspace switcher", () => {
  it("guest sees only the Guest Portal", () => {
    const ws = visibleWorkspaces("guest");
    expect(ws.map((w) => w.area)).toEqual(["guest"]);
    expect(hasInternalWorkspace("guest")).toBe(false);
  });

  it("administrator sees Guest Portal and Administration", () => {
    const ws = visibleWorkspaces("administrator");
    const areas = ws.map((w) => w.area);
    expect(areas).toContain("guest");
    expect(areas).toContain("admin");
    expect(hasInternalWorkspace("administrator")).toBe(true);
  });

  it("front-of-house staff sees Guest Portal and Staff Operations", () => {
    const ws = visibleWorkspaces("foh_staff");
    const areas = ws.map((w) => w.area);
    expect(areas).toContain("guest");
    expect(areas).toContain("staff");
    expect(areas).not.toContain("admin");
  });

  it("kitchen staff sees Guest Portal and Kitchen", () => {
    const ws = visibleWorkspaces("kitchen_staff");
    const areas = ws.map((w) => w.area);
    expect(areas).toContain("guest");
    expect(areas).toContain("kitchen");
    expect(areas).not.toContain("admin");
    expect(areas).not.toContain("staff");
  });

  it("content manager sees Guest Portal and Administration", () => {
    const ws = visibleWorkspaces("content_manager");
    const areas = ws.map((w) => w.area);
    expect(areas).toContain("guest");
    expect(areas).toContain("admin");
  });

  it("every workspace has a destination route", () => {
    for (const w of WORKSPACES) {
      expect(w.to.startsWith("/")).toBe(true);
    }
  });

  it("guest never gains access to an internal workspace through the switcher", () => {
    const internal: WorkspaceArea[] = ["staff", "kitchen", "admin"];
    const ws = visibleWorkspaces("guest");
    for (const area of internal) {
      expect(ws.some((w) => w.area === area)).toBe(false);
    }
  });

  it("every role sees at least the Guest Portal", () => {
    const roles: RoleKey[] = [
      "guest",
      "foh_staff",
      "kitchen_staff",
      "content_manager",
      "ops_manager",
      "administrator",
    ];
    for (const r of roles) {
      const ws = visibleWorkspaces(r);
      expect(ws.some((w) => w.area === "guest")).toBe(true);
    }
  });
});
