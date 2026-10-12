/**
 * Confirm Reservation — stale-response guard tests.
 *
 * Exercises the REAL production operation-guard helper
 * (confirm-reservation-guard.ts) used by ConfirmReservationDialog and
 * ConfirmReservationPanel. These are pure-logic tests, not rendered
 * interaction tests. @testing-library/react / jsdom are not installed and the
 * vitest environment is `node`, so the React wiring (refs, setState, event
 * callbacks) that calls these helpers is source-inspected, not exercised here.
 *
 * The guard logic below IS the production logic the components delegate to;
 * only the React glue is not exercised.
 */
import { describe, it, expect } from "vitest";

import {
  acquireLock,
  beginOperation,
  createOperationGuard,
  createOwnerLock,
  invalidateAll,
  isCurrentOperation,
  isForReservation,
  isLocked,
  ownsLock,
  releaseLock,
  setActiveReservation,
} from "@/components/admin/confirm-reservation-guard";

const RES_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RES_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("operation identity / generation invalidation", () => {
  it("a fresh snapshot is current immediately after beginOperation", () => {
    const guard = createOperationGuard();
    const snap = beginOperation(guard, RES_A);
    expect(isCurrentOperation(guard, snap)).toBe(true);
  });

  it("switching A → B makes the A snapshot obsolete", () => {
    const guard = createOperationGuard();
    const snapA = beginOperation(guard, RES_A);
    setActiveReservation(guard, RES_B);
    expect(isCurrentOperation(guard, snapA)).toBe(false);
  });

  it("A → B → A does NOT revive the original A operation", () => {
    const guard = createOperationGuard();
    const snapA = beginOperation(guard, RES_A);
    setActiveReservation(guard, RES_B);
    setActiveReservation(guard, RES_A); // returns to A, new generation
    expect(isCurrentOperation(guard, snapA)).toBe(false);
    // A new operation for A is current.
    const snapA2 = beginOperation(guard, RES_A);
    expect(snapA2.generation).toBeGreaterThan(snapA.generation);
    expect(isCurrentOperation(guard, snapA2)).toBe(true);
  });

  it("close (null) invalidates pending operations", () => {
    const guard = createOperationGuard();
    const snap = beginOperation(guard, RES_A);
    setActiveReservation(guard, null);
    expect(isCurrentOperation(guard, snap)).toBe(false);
  });

  it("invalidateAll invalidates pending operations (unmount)", () => {
    const guard = createOperationGuard();
    const snap = beginOperation(guard, RES_A);
    invalidateAll(guard);
    expect(isCurrentOperation(guard, snap)).toBe(false);
    // A new operation after invalidation gets a strictly greater generation.
    const snap2 = beginOperation(guard, RES_A);
    expect(snap2.generation).toBeGreaterThan(snap.generation);
    expect(isCurrentOperation(guard, snap2)).toBe(true);
  });

  it("a newer operation supersedes an older one", () => {
    const guard = createOperationGuard();
    const snap1 = beginOperation(guard, RES_A);
    const snap2 = beginOperation(guard, RES_A);
    expect(isCurrentOperation(guard, snap1)).toBe(false);
    expect(isCurrentOperation(guard, snap2)).toBe(true);
  });
});

describe("owner-locked lock prevents stale finally from unlocking newer work", () => {
  it("old completion cannot release the newer lock", () => {
    const lock = createOwnerLock();
    const op1 = { reservationId: RES_A, generation: 1 };
    const op2 = { reservationId: RES_A, generation: 2 };
    acquireLock(lock, op1);
    // Simulate op1 finishing, but op2 has already taken over.
    releaseLock(lock, op1);
    acquireLock(lock, op2);
    // op1's finally runs AFTER op2 acquired — must NOT release op2's lock.
    releaseLock(lock, op1);
    expect(ownsLock(lock, op2)).toBe(true);
    expect(isLocked(lock)).toBe(true);
  });

  it("duplicate operations are synchronously blocked", () => {
    const guard = createOperationGuard();
    const lock = createOwnerLock();
    const snap1 = beginOperation(guard, RES_A);
    expect(acquireLock(lock, snap1)).toBe(true);
    const snap2 = beginOperation(guard, RES_A);
    expect(acquireLock(lock, snap2)).toBe(false);
    expect(isLocked(lock)).toBe(true);
  });

  it("releaseLock by a non-owner is a no-op", () => {
    const lock = createOwnerLock();
    const owner = { reservationId: RES_A, generation: 1 };
    const other = { reservationId: RES_A, generation: 2 };
    acquireLock(lock, owner);
    releaseLock(lock, other);
    expect(ownsLock(lock, owner)).toBe(true);
  });
});

describe("panel reload identity validation", () => {
  it("a reload result for a different reservation id is not current", () => {
    const guard = createOperationGuard();
    const snapA = beginOperation(guard, RES_A);
    setActiveReservation(guard, RES_B);
    // The panel compares the snapshot to current identity; B is current, not A.
    expect(isCurrentOperation(guard, snapA)).toBe(false);
    expect(isForReservation(guard, RES_A)).toBe(false);
  });

  it("a stale same-reservation result (superseded) is not current", () => {
    const guard = createOperationGuard();
    const snap1 = beginOperation(guard, RES_A);
    const snap2 = beginOperation(guard, RES_A);
    expect(isCurrentOperation(guard, snap1)).toBe(false);
    expect(isCurrentOperation(guard, snap2)).toBe(true);
  });

  it("after close/unmount no operation is current", () => {
    const guard = createOperationGuard();
    const snap = beginOperation(guard, RES_A);
    invalidateAll(guard);
    expect(isCurrentOperation(guard, snap)).toBe(false);
    expect(isForReservation(guard, RES_A)).toBe(false);
  });
});
