/**
 * Booking wizard Step 2 (Meals & extras) — stateful hook.
 *
 * Owns catalog loading, guest allocation handlers, shared-platter handlers,
 * and the debounced server-authoritative pricing estimate. Returns everything
 * the MealsStep component needs. Client-safe; server functions are injected.
 *
 * Quote lifecycle:
 *  - A request-generation guard invalidates stale responses so an older quote
 *    can never replace the estimate for newer selections.
 *  - Retry re-requests a fresh quote for the current valid selections.
 *  - Leaving Step 2, incomplete selections, or unmount all invalidate pending
 *    responses and clear outdated quote/loading state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { QuoteResult } from "@/lib/public-quote.functions";
import type { PublicOrderingCatalog } from "@/lib/booking/public-catalog";
import type { SelectionCategory } from "@/lib/ordering/constants";
import {
  applyPackage,
  applyPackageToAll,
  copyMealToGuests,
  reconcileAllocations,
  setAddonQuantity,
  toggleSelection,
  allGuestsComplete,
  setSharedPackage,
  toggleSharedSelection as toggleSharedSelectionForAllocations,
  type GuestAllocation,
} from "@/lib/booking/meals-helpers";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";

type LoadStatus = "loading" | "success" | "error";

interface UseBookingMealsArgs {
  state: BookWizardState;
  setState: (updater: (prev: BookWizardState) => BookWizardState) => void;
  getCatalog: () => Promise<
    { ok: true; catalog: PublicOrderingCatalog } | { ok: false; error: string }
  >;
  getQuote: (input: { data: Record<string, unknown> }) => Promise<QuoteResult>;
}

export function useBookingMeals({ state, setState, getCatalog, getQuote }: UseBookingMealsArgs) {
  const [catalog, setCatalog] = useState<PublicOrderingCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<LoadStatus>("loading");
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const catalogGen = useRef(0);
  const quoteGen = useRef(0);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fingerprint of the exact request inputs that produced the current
  // successful quote. Set when a quote resolves ok; cleared on retry, when
  // leaving both steps, when inputs become incomplete, and on stale responses.
  // canContinueFromMeals compares this against the current inputs' hash so an
  // OLD successful quote can never enable Continue after selections change but
  // before the debounced quote effect has re-requested.
  const quoteInputHash = useRef<string | null>(null);

  const loadCatalog = useCallback(async () => {
    const gen = ++catalogGen.current;
    setCatalogStatus("loading");
    setCatalogError(null);
    try {
      const result = await getCatalog();
      if (gen !== catalogGen.current) return;
      if (!result.ok) {
        setCatalogStatus("error");
        setCatalogError(result.error ?? "We couldn't load the menu. Please try again.");
        return;
      }
      setCatalog(result.catalog);
      setCatalogStatus("success");
    } catch {
      if (gen !== catalogGen.current) return;
      setCatalogStatus("error");
      setCatalogError("We couldn't load the menu. Please try again.");
    }
  }, [getCatalog]);

  // Load the catalog once when entering Step 2 (if not already loaded).
  useEffect(() => {
    if (state.step === "meals" && catalogStatus === "loading" && catalog === null) {
      void loadCatalog();
    }
  }, [state.step, catalogStatus, catalog, loadCatalog]);

  const applyPackageToGuest = useCallback(
    (guestIndex: number, packageId: string) => {
      setState((s) => {
        const pkg = catalog?.packages.find((p) => p.id === packageId);
        if (!pkg) return s;
        const allocations = s.meals.allocations.map((a) =>
          a.guestIndex === guestIndex ? applyPackage(a, pkg, catalog?.addons) : a,
        );
        return { ...s, meals: { ...s.meals, allocations } };
      });
    },
    [catalog, setState],
  );

  const applyPackageAll = useCallback(
    (packageId: string) => {
      setState((s) => {
        const pkg = catalog?.packages.find((p) => p.id === packageId);
        if (!pkg) return s;
        const allocations = applyPackageToAll(s.meals.allocations, pkg, catalog?.addons);
        return { ...s, meals: { ...s.meals, allocations } };
      });
    },
    [catalog, setState],
  );

  const toggleGuestSelection = useCallback(
    (guestIndex: number, menuItemId: string, category: SelectionCategory) => {
      setState((s) => {
        const allocations = s.meals.allocations.map((a) => {
          if (a.guestIndex !== guestIndex) return a;
          const pkg = a.packageId ? catalog?.packages.find((p) => p.id === a.packageId) : undefined;
          if (!pkg) return a;
          return toggleSelection(a, pkg, menuItemId, category);
        });
        return { ...s, meals: { ...s.meals, allocations } };
      });
    },
    [catalog, setState],
  );

  const setGuestAddonQty = useCallback(
    (guestIndex: number, addonId: string, quantity: number) => {
      setState((s) => {
        const allocations = s.meals.allocations.map((a) =>
          a.guestIndex === guestIndex ? setAddonQuantity(a, addonId, quantity) : a,
        );
        return { ...s, meals: { ...s.meals, allocations } };
      });
    },
    [setState],
  );

  const setPlatters = useCallback(
    (platters: Array<{ platterId: string; quantity: number }>) => {
      setState((s) => ({ ...s, meals: { ...s.meals, platters } }));
    },
    [setState],
  );

  // --- Party-wide feast selector (public Step 2) ---

  const applySharedPackage = useCallback(
    (packageId: string) => {
      setState((s) => {
        const pkg = catalog?.packages.find((p) => p.id === packageId);
        if (!pkg) return s;
        const allocations = setSharedPackage(s.meals.allocations, pkg, catalog?.addons);
        return { ...s, meals: { ...s.meals, allocations } };
      });
    },
    [catalog, setState],
  );

  const toggleSharedSelection = useCallback(
    (menuItemId: string, category: SelectionCategory) => {
      setState((s) => {
        if (s.meals.allocations.length === 0) return s;
        const first = s.meals.allocations[0];
        if (!first || !first.packageId) return s;
        const pkg = catalog?.packages.find((p) => p.id === first.packageId);
        if (!pkg) return s;
        const allocations = toggleSharedSelectionForAllocations(
          s.meals.allocations,
          pkg,
          menuItemId,
          category,
        );
        return { ...s, meals: { ...s.meals, allocations } };
      });
    },
    [catalog, setState],
  );

  const copyMealToTargets = useCallback(
    (sourceIndex: number, targetIndices: number[]) => {
      setState((s) => {
        const allocations = copyMealToGuests(
          s.meals.allocations,
          sourceIndex,
          targetIndices,
          catalog?.addons,
        );
        return { ...s, meals: { ...s.meals, allocations } };
      });
    },
    [catalog, setState],
  );

  /**
   * Update ONE guest's personal field (name or a dietary note). Targets the
   * guest by stable guestId so a note stays attached to the right person even
   * if guestIndex changes during party reconciliation. Does NOT touch meal
   * selections, shared platter quantities, or any other guest's data.
   */
  const setGuestField = useCallback(
    (
      guestId: string,
      field: "name" | "foodAllergies" | "dietaryPreferences" | "mealRequests",
      value: string,
    ) => {
      setState((s) => {
        const allocations = s.meals.allocations.map((a) =>
          a.guestId === guestId ? { ...a, [field]: value } : a,
        );
        return { ...s, meals: { ...s.meals, allocations } };
      });
    },
    [setState],
  );

  const mealsComplete =
    catalog !== null &&
    state.meals.allocations.length > 0 &&
    allGuestsComplete(state.meals.allocations, catalog);

  // Build the quote request payload from current state. Returns null when the
  // selections are not complete enough to quote.
  const buildQuoteInput = useCallback((): { data: Record<string, unknown> } | null => {
    if (!state.sundayServiceId || !state.seatingTimeId || !mealsComplete) return null;
    return {
      data: {
        sundayServiceId: state.sundayServiceId,
        seatingTimeId: state.seatingTimeId,
        guests: state.meals.allocations.map((a) => ({
          guestIndex: a.guestIndex,
          category: a.category,
          name: a.name,
          packageId: a.packageId ?? "",
          included: a.included,
          addons: a.addons,
        })),
        platters: state.meals.platters,
      },
    };
  }, [
    state.sundayServiceId,
    state.seatingTimeId,
    mealsComplete,
    state.meals.allocations,
    state.meals.platters,
  ]);

  // The single quote-request function. Bumps the generation guard, debounces,
  // and only applies a result if its generation is still current.
  const requestQuote = useCallback(() => {
    // Invalidate any pending response.
    quoteGen.current += 1;
    const gen = quoteGen.current;

    const input = buildQuoteInput();
    if (!input) {
      // Incomplete or left Step 2: clear outdated state, no request.
      if (quoteTimer.current) {
        clearTimeout(quoteTimer.current);
        quoteTimer.current = null;
      }
      setQuote(null);
      setQuoteLoading(false);
      setQuoteError(null);
      quoteInputHash.current = null;
      return;
    }

    setQuoteLoading(true);
    setQuoteError(null);

    const inputHash = computeQuoteInputHash(input.data);

    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(async () => {
      quoteTimer.current = null;
      try {
        const result = await getQuote(input);
        // Stale guard: an older response can never replace newer state.
        if (gen !== quoteGen.current) return;
        setQuote(result);
        setQuoteLoading(false);
        if (!result.ok) {
          setQuoteError(result.error ?? "We couldn't calculate your estimate. Please try again.");
          quoteInputHash.current = null;
        } else {
          setQuoteError(null);
          // Record the fingerprint of the exact inputs that produced this
          // successful quote so canContinueFromMeals can verify freshness.
          quoteInputHash.current = inputHash;
        }
      } catch {
        if (gen !== quoteGen.current) return;
        setQuoteError("We couldn't calculate your estimate. Please try again.");
        setQuoteLoading(false);
        quoteInputHash.current = null;
      }
    }, 500);
  }, [buildQuoteInput, getQuote]);

  // Debounced server-authoritative pricing estimate. Re-requests whenever the
  // relevant inputs change; the generation guard inside requestQuote handles
  // stale invalidation.
  // The quote is requested on both the "meals" step (live estimate while
  // editing) and the "review" step (fresh authoritative estimate before
  // submission). Leaving both steps invalidates any pending response.
  useEffect(() => {
    if (state.step !== "meals" && state.step !== "review") {
      // Left both Step 2 and Step 4: invalidate pending + clear outdated quote.
      quoteGen.current += 1;
      if (quoteTimer.current) {
        clearTimeout(quoteTimer.current);
        quoteTimer.current = null;
      }
      setQuote(null);
      setQuoteLoading(false);
      setQuoteError(null);
      quoteInputHash.current = null;
      return;
    }
    requestQuote();
    return () => {
      if (quoteTimer.current) {
        clearTimeout(quoteTimer.current);
        quoteTimer.current = null;
      }
    };
  }, [
    state.step,
    state.sundayServiceId,
    state.seatingTimeId,
    mealsComplete,
    requestQuote,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(state.meals.allocations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(state.meals.platters),
  ]);

  // Clear pending quote on unmount.
  useEffect(() => {
    return () => {
      quoteGen.current += 1;
      if (quoteTimer.current) {
        clearTimeout(quoteTimer.current);
        quoteTimer.current = null;
      }
    };
  }, []);

  // Retry must re-request a fresh quote for the current valid selections.
  const retryQuote = useCallback(() => {
    setQuote(null);
    setQuoteError(null);
    quoteInputHash.current = null;
    requestQuote();
  }, [requestQuote]);

  // Readiness for advancing past Step 2. Requires complete meal selections AND
  // a current, successful, resolved quote for those EXACT inputs. The
  // quoteInputHash fingerprint is set when a quote resolves ok and cleared on
  // retry, leaving both steps, incomplete inputs, and stale responses. This
  // guards the render window between a state change and the debounced quote
  // effect re-requesting — an OLD successful quote whose inputs no longer match
  // current state can never enable Continue.
  const currentInputHash = buildQuoteInput()
    ? computeQuoteInputHash(buildQuoteInput()!.data)
    : null;

  const canContinueFromMeals = isMealsStepReady(
    mealsComplete,
    quote,
    quoteLoading,
    quoteError,
    quoteInputHash.current,
    currentInputHash,
  );

  return {
    catalog,
    catalogStatus,
    catalogError,
    loadCatalog,
    applyPackageToGuest,
    applyPackageAll,
    toggleGuestSelection,
    setGuestAddonQty,
    setPlatters,
    copyMealToTargets,
    mealsComplete,
    canContinueFromMeals,
    quote,
    quoteLoading,
    quoteError,
    retryQuote,
    applySharedPackage,
    toggleSharedSelection,
    setGuestField,
  };
}

/** Reconcile guest allocations against a new party composition. */
export function reconcileMealsAllocations(
  allocations: BookWizardState["meals"]["allocations"],
  adults: number,
  seniors: number,
  children: number,
) {
  return reconcileAllocations(allocations, adults, seniors, children);
}

/**
 * Compute a stable fingerprint of the exact quote request inputs. Used to
 * verify that a successful quote matches the current booking inputs so an OLD
 * quote can never enable Continue after selections change.
 *
 * Excludes volatile per-render values (e.g. newly generated reservation
 * numbers). Hashes a CANONICAL representation so property ordering does not
 * change the meaning.
 */
export function computeQuoteInputHash(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    hash = (hash << 5) - hash + canonical.charCodeAt(i);
    hash |= 0; // 32-bit int
  }
  return `qih_${hash >>> 0}`;
}

/**
 * Production readiness logic for advancing past Step 2. Requires complete meal
 * selections AND a current, successful, resolved quote whose input fingerprint
 * matches the current inputs. Exported for direct unit testing.
 */
export function isMealsStepReady(
  mealsComplete: boolean,
  quote: QuoteResult | null,
  quoteLoading: boolean,
  quoteError: string | null,
  quoteInputHash: string | null,
  currentInputHash: string | null,
): boolean {
  return (
    mealsComplete &&
    quote !== null &&
    quote.ok &&
    !quoteLoading &&
    quoteError === null &&
    !quote.hasUnresolvedRules &&
    currentInputHash !== null &&
    quoteInputHash === currentInputHash
  );
}
