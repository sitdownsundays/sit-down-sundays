import { describe, it, expect } from "vitest";

/* Focused tests for the package-pricing recovery safeguards:
 * assessConfigSyncWithRecoveryGate and mayUpdateRecoveryError.
 *
 * These exercise production-used pure helpers, not rendered UI.
 */
import {
  assessConfigSyncWithRecoveryGate,
  mayUpdateRecoveryError,
} from "@/components/admin/package-pricing-helpers";

describe("assessConfigSyncWithRecoveryGate — recovery gate protection", () => {
  it("active conflict + changed config + no dirty edits → gate retained, editor not overwritten", () => {
    const g = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: true,
      hasDirtyEdits: false,
      needsResync: false,
      hasFoundPackage: true,
    });
    expect(g.shouldAdopt).toBe(false);
    expect(g.shouldClearGate).toBe(false);
    expect(g.shouldClearResync).toBe(false);
  });

  it("active gate + needsResync=true → gate retained", () => {
    const g = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: true,
      hasDirtyEdits: false,
      needsResync: true,
      hasFoundPackage: true,
    });
    expect(g.shouldAdopt).toBe(false);
    expect(g.shouldClearGate).toBe(false);
    expect(g.shouldClearResync).toBe(false);
  });

  it("verified recovery (gate inactive) → editor adopted and gate cleared", () => {
    const g = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: false,
      hasDirtyEdits: false,
      needsResync: true,
      hasFoundPackage: true,
    });
    expect(g.shouldAdopt).toBe(true);
    expect(g.shouldClearGate).toBe(true);
    expect(g.shouldClearResync).toBe(true);
  });

  it("dirty edits with no resync request (gate inactive) → preserve unsaved edits", () => {
    const g = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: false,
      hasDirtyEdits: true,
      needsResync: false,
      hasFoundPackage: true,
    });
    expect(g.shouldAdopt).toBe(false);
    expect(g.shouldClearGate).toBe(false);
    expect(g.shouldClearResync).toBe(false);
  });

  it("dirty edits with needsResync=true (gate inactive) → adopt (explicit reload requested)", () => {
    const g = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: false,
      hasDirtyEdits: true,
      needsResync: true,
      hasFoundPackage: true,
    });
    expect(g.shouldAdopt).toBe(true);
    expect(g.shouldClearGate).toBe(true);
    expect(g.shouldClearResync).toBe(true);
  });

  it("package not found + gate inactive → no adopt, clear resync", () => {
    const g = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: false,
      hasDirtyEdits: false,
      needsResync: true,
      hasFoundPackage: false,
    });
    expect(g.shouldAdopt).toBe(false);
    expect(g.shouldClearGate).toBe(false);
    expect(g.shouldClearResync).toBe(true);
  });

  it("package not found + gate active → no adopt, do not clear resync", () => {
    const g = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: true,
      hasDirtyEdits: false,
      needsResync: true,
      hasFoundPackage: false,
    });
    expect(g.shouldAdopt).toBe(false);
    expect(g.shouldClearGate).toBe(false);
    expect(g.shouldClearResync).toBe(false);
  });

  it("initial selection (gate inactive, no edits, no resync) → adopt and clear", () => {
    const g = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: false,
      hasDirtyEdits: false,
      needsResync: false,
      hasFoundPackage: true,
    });
    expect(g.shouldAdopt).toBe(true);
    expect(g.shouldClearGate).toBe(true);
    expect(g.shouldClearResync).toBe(true);
  });
});

describe("mayUpdateRecoveryError — stale failure guard", () => {
  it("current + mounted → may update error", () => {
    expect(mayUpdateRecoveryError(1, 1, false)).toBe(true);
  });

  it("superseded operation (opId !== current) → no update", () => {
    expect(mayUpdateRecoveryError(1, 2, false)).toBe(false);
  });

  it("unmounted → no update", () => {
    expect(mayUpdateRecoveryError(1, 1, true)).toBe(false);
  });

  it("superseded + unmounted → no update", () => {
    expect(mayUpdateRecoveryError(1, 3, true)).toBe(false);
  });
});
