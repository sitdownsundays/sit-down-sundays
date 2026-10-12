/**
 * Refresh-result helpers — shared typed result for post-mutation detail/list
 * refreshes.
 *
 * openDetail/reload in admin-reservations.tsx catch their OWN failures and
 * resolve normally (they never throw). A simple await therefore cannot tell
 * whether the refresh actually succeeded. These helpers give callers an
 * explicit typed result distinguishing success, failure, and superseded
 * (stale) requests.
 */

export type RefreshStatus = "success" | "failure" | "superseded";

/**
 * Typed result of a detail or list refresh.
 *
 * - success: the fetch completed and the data is current.
 * - failure: the server returned {ok:false} or threw — the display was NOT
 *   refreshed.
 * - superseded: a newer request for the same surface started; this result must
 *   NOT claim the current display was refreshed or overwrite newer UI.
 */
export interface RefreshResult {
  status: RefreshStatus;
  /** Safe message for failure; empty for success/superseded. */
  error?: string;
}

export const REFRESH_SUCCESS: Readonly<RefreshResult> = { status: "success" };

export function refreshFailure(message: string): RefreshResult {
  return { status: "failure", error: message };
}

export function refreshSuperseded(): RefreshResult {
  return { status: "superseded" };
}

export function isRefreshFailed(r: RefreshResult): boolean {
  return r.status === "failure";
}

export function isRefreshSuperseded(r: RefreshResult): boolean {
  return r.status === "superseded";
}

/**
 * Combine a detail refresh and a list refresh into a single RefreshOutcome
 * for the dialog/panel. A superseded refresh is NOT treated as a failure —
 * a newer operation owns the display now, so the current mutation's caller
 * should not claim a refresh failure it cannot observe. Only a genuine
 * "failure" status surfaces as failed=true.
 */
export function combineRefreshResults(
  detail: RefreshResult,
  list: RefreshResult,
): { detailFailed: boolean; listFailed: boolean } {
  return {
    detailFailed: isRefreshFailed(detail),
    listFailed: isRefreshFailed(list),
  };
}

/**
 * Build a refresh-failure toast message from a combined outcome. Returns null
 * when no refresh failed — the toast is only shown when there is something to
 * report. Kept here so the same message is used across confirmation and
 * cancellation.
 */
export function refreshFailureMessage(
  outcome: { detailFailed: boolean; listFailed: boolean },
  mutationVerb: "Confirmed" | "Cancelled",
): string | null {
  const both = outcome.detailFailed && outcome.listFailed;
  if (both)
    return `${mutationVerb}, but the display could not be refreshed. Reload the page to see updates.`;
  if (outcome.detailFailed)
    return `${mutationVerb}, but the reservation detail could not be refreshed. Reload the page to see updates.`;
  if (outcome.listFailed)
    return `${mutationVerb}, but the reservation list could not be refreshed. Reload the page to see updates.`;
  return null;
}

/* --------------------- Post-mutation refresh orchestration --------------------- */

/**
 * Combined result of refreshing detail + list after a successful mutation.
 * Each surface keeps its own RefreshResult so a superseded refresh is never
 * confused with a failure, and neither refresh can mask the other.
 */
export interface CombinedRefreshResult {
  detail: RefreshResult;
  list: RefreshResult;
}

/**
 * Run the detail and list refresh independently after a successful mutation.
 *
 * - Each callback returns a typed RefreshResult (never throws — the loaders
 *   catch their own failures).
 * - If a callback unexpectedly throws, convert it to a safe failure so the
 *   dialog can still report the problem without crashing.
 * - A failure in one refresh does NOT block the other, and neither
 *   invalidates the successful mutation.
 * - This function never invokes a mutation.
 */
export async function runPostMutationRefresh(
  refreshDetail: () => Promise<RefreshResult>,
  refreshList: () => Promise<RefreshResult>,
): Promise<CombinedRefreshResult> {
  let detail: RefreshResult;
  try {
    detail = await refreshDetail();
  } catch {
    detail = refreshFailure("The reservation detail could not be refreshed.");
  }
  let list: RefreshResult;
  try {
    list = await refreshList();
  } catch {
    list = refreshFailure("The reservation list could not be refreshed.");
  }
  return { detail, list };
}

/**
 * True only when a refresh actually FAILED. A "superseded" result is NOT a
 * failure — a newer operation owns the display, so the current mutation's
 * caller should not claim a refresh failure it cannot observe.
 */
export function combinedHasRefreshFailure(r: CombinedRefreshResult): boolean {
  return isRefreshFailed(r.detail) || isRefreshFailed(r.list);
}

/**
 * Warning message shown when a mutation succeeded but the display could not
 * be refreshed. A "superseded" refresh alone is NOT a failure — a newer
 * operation owns the display, so the current caller should not warn about a
 * refresh it cannot observe. A mixed failure/superseded result still
 * contains a genuine failure, so the warning fires. Returns null when
 * neither refresh failed (so no toast is emitted).
 *
 * `mutationVerb` is the past-tense action label (confirmed/cancelled).
 */
export function refreshWarningForOutcome(
  r: CombinedRefreshResult,
  mutationVerb: "confirmed" | "cancelled" | "approved",
): string | null {
  if (!combinedHasRefreshFailure(r)) return null;
  const both = isRefreshFailed(r.detail) && isRefreshFailed(r.list);
  if (both)
    return `${mutationVerb}, but some displayed information could not be refreshed. Reload the reservation list before making another change.`;
  if (isRefreshFailed(r.detail))
    return `${mutationVerb}, but some displayed information could not be refreshed. Reload the reservation list before making another change.`;
  if (isRefreshFailed(r.list))
    return `${mutationVerb}, but some displayed information could not be refreshed. Reload the reservation list before making another change.`;
  return null;
}
