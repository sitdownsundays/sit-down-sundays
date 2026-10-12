/**
 * Confirm Reservation — operation guard.
 *
 * Tracks a current operation identity (reservation ID + generation) and an
 * owner-locked synchronous lock so that obsolete async results cannot:
 *  - mutate component state,
 *  - clear/block the parent gate,
 *  - invoke success/close/refresh callbacks, or
 *  - release a newer operation's lock.
 *
 * Identity combines reservationId + generation. A→B→A is a NEW lifecycle:
 * matching the reservation id alone is insufficient. Generation increments on
 * reservation change, close, and unmount. Current identity is read via a ref
 * (not captured props) so comparisons use the latest values.
 */
export interface OperationIdentity {
  reservationId: string;
  generation: number;
}

export interface OperationGuard {
  /** Ref holding the current identity (latest values, not captured). */
  identityRef: { current: OperationIdentity | null };
  /** Current generation counter. */
  generation: number;
}

/**
 * Create a fresh guard. generation starts at 0; identity is null until a
 * reservation opens.
 */
export function createOperationGuard(): OperationGuard {
  return {
    identityRef: { current: null },
    generation: 0,
  };
}

/**
 * Begin a new operation for the given reservation id. Increments generation
 * (invalidating any older operation), records current identity, and returns
 * a snapshot to compare against before applying the async result.
 *
 * Returns the snapshot identity for this operation.
 */
export function beginOperation(guard: OperationGuard, reservationId: string): OperationIdentity {
  guard.generation += 1;
  const snapshot: OperationIdentity = { reservationId, generation: guard.generation };
  guard.identityRef.current = snapshot;
  return snapshot;
}

/**
 * Invalidate all pending operations (close/unmount). A later operation with
 * the same reservation id gets a strictly greater generation, so A→B→A cannot
 * revive the original operation.
 */
export function invalidateAll(guard: OperationGuard): void {
  guard.generation += 1;
  guard.identityRef.current = null;
}

/**
 * Change the active reservation. Increments generation so any operation tied
 * to the previous reservation is obsolete; records the new identity if non-null.
 */
export function setActiveReservation(guard: OperationGuard, reservationId: string | null): void {
  guard.generation += 1;
  if (reservationId === null) {
    guard.identityRef.current = null;
  } else {
    guard.identityRef.current = { reservationId, generation: guard.generation };
  }
}

/**
 * True if the snapshot is still the current operation: the current identity
 * matches its reservationId AND its generation equals the current generation.
 * Reads the ref (latest values), not captured props.
 */
export function isCurrentOperation(guard: OperationGuard, snapshot: OperationIdentity): boolean {
  const current = guard.identityRef.current;
  if (!current) return false;
  return (
    current.reservationId === snapshot.reservationId && current.generation === snapshot.generation
  );
}

/**
 * True if the current operation is for the given reservation id (regardless of
 * generation). Used to decide whether a stale same-reservation result may
 * still update non-state surfaces.
 */
export function isForReservation(guard: OperationGuard, reservationId: string): boolean {
  const current = guard.identityRef.current;
  return current?.reservationId === reservationId;
}

/* -------------------------------------------------------------------------- */
/* Owner-locked synchronous lock                                              */
/* -------------------------------------------------------------------------- */

/**
 * A synchronous lock keyed by owner identity so an old operation's finally
 * block cannot release a newer operation's lock.
 */
export interface OwnerLock {
  /** Ref holding { owner: identity | null }. */
  ref: { current: { owner: OperationIdentity | null } };
}

export function createOwnerLock(): OwnerLock {
  return { ref: { current: { owner: null } } };
}

/** Acquire the lock for the given operation if free. Returns true if acquired. */
export function acquireLock(lock: OwnerLock, owner: OperationIdentity): boolean {
  if (lock.ref.current.owner !== null) return false;
  lock.ref.current.owner = owner;
  return true;
}

/** Release the lock only if the given owner still holds it. */
export function releaseLock(lock: OwnerLock, owner: OperationIdentity): void {
  const current = lock.ref.current.owner;
  if (
    current &&
    current.reservationId === owner.reservationId &&
    current.generation === owner.generation
  ) {
    lock.ref.current.owner = null;
  }
}

/** True if the given owner currently holds the lock. */
export function ownsLock(lock: OwnerLock, owner: OperationIdentity): boolean {
  const current = lock.ref.current.owner;
  return (
    !!current &&
    current.reservationId === owner.reservationId &&
    current.generation === owner.generation
  );
}

/** True if any owner currently holds the lock. */
export function isLocked(lock: OwnerLock): boolean {
  return lock.ref.current.owner !== null;
}
