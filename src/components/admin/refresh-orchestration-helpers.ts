/**
 * Refresh orchestration — pure, framework-agnostic helpers.
 *
 * After a successful mutation (confirm/cancel), the panel refreshes the
 * displayed detail and the list INDEPENDENTLY. Each refresh returns a typed
 * result so the panel can report a refresh failure WITHOUT invalidating the
 * successful mutation, and WITHOUT re-running the mutation.
 *
 * A "superseded" refresh (the user navigated away, opened a different
 * reservation, or the dialog closed) is distinct from a "failed" refresh: it
 * must not claim the current display was refreshed, and it must not overwrite
 * newer UI (no toast/notice for a superseded operation).
 *
 * These helpers are used by BOTH the confirmation and cancellation panels, so
 * tests against them exercise the REAL production logic.
 */

/** Result of a single detail or list refresh. */
export type RefreshKind = "detail" | "list";

export interface RefreshAttempt {
  /** What was refreshed. */
  kind: RefreshKind;
  /** True only if the refresh fetched and applied new data. */
  ok: boolean;
  /**
   * True if the refresh did not apply because a newer operation superseded it
   * (navigation, close, unmount, or a different reservation). Distinct from a
   * failure: a superseded refresh must NOT show a warning or overwrite newer UI.
   */
  superseded: boolean;
}

/** Outcome of refreshing detail + list after a successful mutation. */
export interface RefreshOutcome {
  detailFailed: boolean;
  listFailed: boolean;
  /**
   * True if EITHER refresh was superseded. When superseded, the caller must
   * not show a notice/toast (the newer UI is already in charge) and must not
   * claim the current display was refreshed.
   */
  superseded: boolean;
}

/**
 * Fold two refresh attempts into the outcome the panel reports.
 *
 * - A superseded attempt is NOT a failure and does NOT produce a warning.
 * - A failed attempt (ok=false, superseded=false) is a failure.
 * - An ok attempt is neither.
 *
 * If any attempt was superseded, the whole outcome is superseded (the panel
 * should not surface any notice, because the current UI is no longer the one
 * the mutation was performed against).
 */
export function toRefreshOutcome(detail: RefreshAttempt, list: RefreshAttempt): RefreshOutcome {
  const superseded = detail.superseded || list.superseded;
  return {
    detailFailed: !detail.ok && !detail.superseded,
    listFailed: !list.ok && !list.superseded,
    superseded,
  };
}

/**
 * Whether to show a refresh-failure warning given the outcome.
 * Superseded outcomes show nothing. Only a real (non-superseded) failure shows.
 */
export function shouldShowRefreshWarning(outcome: RefreshOutcome): boolean {
  if (outcome.superseded) return false;
  return outcome.detailFailed || outcome.listFailed;
}

/**
 * Build the refresh-failure message. Returns null when no warning should show
 * (success or superseded).
 */
export function refreshWarningMessage(
  outcome: RefreshOutcome,
  detailMsg: string,
  listMsg: string,
  bothMsg: string,
): string | null {
  if (!shouldShowRefreshWarning(outcome)) return null;
  if (outcome.detailFailed && outcome.listFailed) return bothMsg;
  if (outcome.detailFailed) return detailMsg;
  return listMsg;
}
