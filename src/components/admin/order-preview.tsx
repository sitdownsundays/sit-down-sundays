/**
 * Admin-only "Preview an order" tool.
 *
 * Progressive flow: party composition → assign packages → per-guest included
 * choices + add-ons → shared platters → itemized pricing review.
 *
 * Uses the single server-authoritative calculateOrderPreview path. Included
 * dishes are never charged again. Platters are per-platter. Discounts apply
 * only to explicitly configured eligible charges. Unresolved tax/fee rules
 * surface as "Not configured".
 *
 * Per-guest included selections are validated server-side against the
 * package's eligible items and included counts. Switching a guest's package
 * clears selections that are no longer eligible.
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { ErrorState } from "@/components/layout/error-state";
import { getOrderingConfig, calculateOrderPreview } from "@/lib/ordering.functions";
import type { OrderingConfigDTO, MealPackageDTO } from "@/lib/ordering/types";
import type { GuestCategory, SelectionCategory } from "@/lib/ordering/constants";
import { SELECTION_CATEGORY_LABELS } from "@/lib/ordering/constants";

type Selection = { menuItemId: string; selectionCategory: string };

type GuestRow = {
  id: string;
  name: string;
  category: GuestCategory;
  packageId: string;
  includedSelections: Selection[];
  addons: Array<{ addonId: string; quantity: number }>;
};

let guestSeq = 0;
function makeGuest(category: GuestCategory): GuestRow {
  guestSeq += 1;
  return {
    id: `g-${guestSeq}`,
    name: "",
    category,
    packageId: "",
    includedSelections: [],
    addons: [],
  };
}

const COUNT_CATS: SelectionCategory[] = ["meat", "side"];
const OPTIONAL_CATS: SelectionCategory[] = ["bread", "drink"];

export function OrderPreview() {
  const configQuery = useQuery({
    queryKey: ["ordering-config"],
    queryFn: async () => {
      const res = await getOrderingConfig();
      return res.ok ? res.config : null;
    },
  });

  const [adults, setAdults] = useState(0);
  const [seniors, setSeniors] = useState(0);
  const [children, setChildren] = useState(0);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [composed, setComposed] = useState(false);
  const [platters, setPlatters] = useState<Array<{ platterId: string; quantity: number }>>([]);
  const [preview, setPreview] = useState<null | {
    lines: Array<{ label: string; amountCents: number; kind: string }>;
    subtotalCents: number;
    hasUnresolvedRules: boolean;
    unresolvedNotes: string[];
  }>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const calcFn = useServerFn(calculateOrderPreview);

  const config: OrderingConfigDTO | null = configQuery.data;

  const totalParty = adults + seniors + children;

  function buildGuests() {
    const rows: GuestRow[] = [];
    for (let i = 0; i < adults; i++) rows.push(makeGuest("adult"));
    for (let i = 0; i < seniors; i++) rows.push(makeGuest("senior"));
    for (let i = 0; i < children; i++) rows.push(makeGuest("child"));
    setGuests(rows);
    setComposed(true);
  }

  function updateGuest(id: string, patch: Partial<GuestRow>) {
    setGuests((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  /** Switching a package clears selections that are no longer eligible. */
  function changePackage(id: string, packageId: string, pkg: MealPackageDTO | undefined) {
    setGuests((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        if (!pkg) return { ...g, packageId, includedSelections: [], addons: [] };
        const eligibleIds = new Set(pkg.eligibleItems.map((e) => e.menuItemId));
        const kept = g.includedSelections.filter((s) => eligibleIds.has(s.menuItemId));
        return { ...g, packageId, includedSelections: kept };
      }),
    );
  }

  function toggleSelection(guestId: string, cat: SelectionCategory, menuItemId: string) {
    setGuests((prev) =>
      prev.map((g) => {
        if (g.id !== guestId) return g;
        const exists = g.includedSelections.find(
          (s) => s.menuItemId === menuItemId && s.selectionCategory === cat,
        );
        if (exists) {
          return {
            ...g,
            includedSelections: g.includedSelections.filter(
              (s) => !(s.menuItemId === menuItemId && s.selectionCategory === cat),
            ),
          };
        }
        return {
          ...g,
          includedSelections: [...g.includedSelections, { menuItemId, selectionCategory: cat }],
        };
      }),
    );
  }

  function setAddon(id: string, addonId: string, quantity: number) {
    setGuests((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const existing = g.addons.find((a) => a.addonId === addonId);
        if (existing) {
          return {
            ...g,
            addons:
              quantity <= 0
                ? g.addons.filter((a) => a.addonId !== addonId)
                : g.addons.map((a) => (a.addonId === addonId ? { ...a, quantity } : a)),
          };
        }
        return quantity > 0 ? { ...g, addons: [...g.addons, { addonId, quantity }] } : g;
      }),
    );
  }

  const partyMismatch = composed && guests.length !== totalParty;

  async function runPreview() {
    if (!config) return;
    setPreviewLoading(true);
    setPreviewError("");
    setPreview(null);
    try {
      const result = await calcFn({
        data: {
          guests: guests.map((g) => ({
            id: g.id,
            category: g.category,
            name: g.name.trim() || undefined,
            packageId: g.packageId,
            includedSelections: g.includedSelections,
            addons: g.addons,
          })),
          platters,
        },
      });
      if (!result.success) {
        setPreviewError(result.error ?? "Could not calculate the preview.");
        return;
      }
      setPreview(result);
    } catch {
      setPreviewError("Could not calculate the preview. Please try again.");
    } finally {
      setPreviewLoading(false);
    }
  }

  if (configQuery.isLoading) return <LoadingState label="Loading ordering configuration…" />;
  if (configQuery.isError)
    return (
      <ErrorState
        title="Couldn't load ordering configuration"
        action={
          <Button variant="outline" onClick={() => configQuery.refetch()}>
            Try again
          </Button>
        }
      />
    );
  if (!config) return null;

  const activePackages = config.packages.filter((p) => p.isActive);
  const activeAddons = config.addons.filter((a) => a.isActive);
  const activePlatters = config.platters.filter((p) => p.isActive);

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="font-display text-xl text-foreground">Preview an order</CardTitle>
        <p className="text-sm text-muted-foreground">
          Build a sample party to see how packages, add-ons, platters, and discounts combine. This
          does not create a reservation or charge anything.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step 1: party composition */}
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground">1. Party composition</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="adults">Adults</Label>
              <Input
                id="adults"
                type="number"
                min="0"
                value={adults}
                disabled={composed}
                onChange={(e) => setAdults(Math.max(0, Number(e.target.value)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seniors">Seniors</Label>
              <Input
                id="seniors"
                type="number"
                min="0"
                value={seniors}
                disabled={composed}
                onChange={(e) => setSeniors(Math.max(0, Number(e.target.value)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="children">Children</Label>
              <Input
                id="children"
                type="number"
                min="0"
                value={children}
                disabled={composed}
                onChange={(e) => setChildren(Math.max(0, Number(e.target.value)))}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Total party size: <strong>{totalParty}</strong> (adults + seniors + children must match)
          </p>
          {!composed ? (
            <Button onClick={buildGuests} disabled={totalParty === 0}>
              Continue to packages
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setComposed(false);
                setGuests([]);
                setPreview(null);
              }}
            >
              Edit party size
            </Button>
          )}
          {partyMismatch && (
            <p className="text-sm text-destructive">
              Guest count no longer matches party size. Reset and rebuild.
            </p>
          )}
        </div>

        {composed && (
          <>
            <Separator />
            {/* Step 2: per-guest packages + included choices + add-ons */}
            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">
                2. Packages, included choices &amp; add-ons per guest
              </h3>
              {activePackages.length === 0 && (
                <EmptyState
                  title="No active packages"
                  description="Create and activate a meal package before previewing an order."
                />
              )}
              <div className="space-y-3">
                {guests.map((g, idx) => {
                  const pkg = activePackages.find((p) => p.id === g.packageId);
                  return (
                    <div key={g.id} className="rounded-lg border border-border p-3 space-y-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`g-${g.id}-name`}>Name (optional)</Label>
                          <Input
                            id={`g-${g.id}-name`}
                            placeholder={`Guest ${idx + 1}`}
                            value={g.name}
                            onChange={(e) => updateGuest(g.id, { name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Category</Label>
                          <div className="rounded-md border border-border px-3 py-2 text-sm capitalize">
                            {g.category}
                          </div>
                        </div>
                        <div className="space-y-1.5 min-w-[200px]">
                          <Label htmlFor={`g-${g.id}-pkg`}>Package</Label>
                          <Select
                            value={g.packageId}
                            onValueChange={(v) =>
                              changePackage(
                                g.id,
                                v,
                                activePackages.find((p) => p.id === v),
                              )
                            }
                          >
                            <SelectTrigger id={`g-${g.id}-pkg`}>
                              <SelectValue placeholder="Select package" />
                            </SelectTrigger>
                            <SelectContent>
                              {activePackages.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} — ${(p.pricePerPersonCents / 100).toFixed(2)}/person
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Included choices */}
                      {pkg && (
                        <IncludedChoices
                          pkg={pkg}
                          guest={g}
                          onToggle={(cat, itemId) => toggleSelection(g.id, cat, itemId)}
                        />
                      )}

                      {/* Add-ons */}
                      {g.packageId && activeAddons.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Individual add-ons
                          </p>
                          {activeAddons.map((a) => {
                            const eligible =
                              a.eligiblePackageIds.length === 0 ||
                              a.eligiblePackageIds.includes(g.packageId);
                            if (!eligible) return null;
                            const current = g.addons.find((x) => x.addonId === a.id)?.quantity ?? 0;
                            return (
                              <div key={a.id} className="flex items-center gap-2">
                                <Label htmlFor={`g-${g.id}-a-${a.id}`} className="flex-1 text-sm">
                                  {a.name} (${(a.priceCents / 100).toFixed(2)})
                                </Label>
                                <Input
                                  id={`g-${g.id}-a-${a.id}`}
                                  type="number"
                                  min="0"
                                  value={current}
                                  onChange={(e) =>
                                    setAddon(g.id, a.id, Math.max(0, Number(e.target.value)))
                                  }
                                  className="w-20"
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator />
            {/* Step 3: shared platters */}
            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">3. Shared platters</h3>
              {activePlatters.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active shared platters.</p>
              ) : (
                <div className="space-y-2">
                  {activePlatters.map((p) => {
                    const current = platters.find((x) => x.platterId === p.id)?.quantity ?? 0;
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        <Label htmlFor={`platter-${p.id}`} className="flex-1 text-sm">
                          {p.name} (${(p.pricePerPlatterCents / 100).toFixed(2)}/platter)
                        </Label>
                        <Input
                          id={`platter-${p.id}`}
                          type="number"
                          min="0"
                          value={current}
                          onChange={(e) => {
                            const qty = Math.max(0, Number(e.target.value));
                            setPlatters((prev) => {
                              const exists = prev.find((x) => x.platterId === p.id);
                              if (exists) {
                                return qty <= 0
                                  ? prev.filter((x) => x.platterId !== p.id)
                                  : prev.map((x) =>
                                      x.platterId === p.id ? { ...x, quantity: qty } : x,
                                    );
                              }
                              return qty > 0 ? [...prev, { platterId: p.id, quantity: qty }] : prev;
                            });
                          }}
                          className="w-20"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator />
            {/* Step 4: review */}
            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">4. Itemized review</h3>
              <Button onClick={runPreview} disabled={previewLoading || partyMismatch}>
                {previewLoading ? "Calculating…" : "Calculate preview"}
              </Button>
              {previewError && <p className="text-sm text-destructive">{previewError}</p>}
              {preview && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                  {preview.lines.length === 0 && (
                    <p className="text-sm text-muted-foreground">No charges yet.</p>
                  )}
                  {preview.lines.map((line, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-foreground">{line.label}</span>
                      <span
                        className={line.amountCents < 0 ? "text-primary" : "text-muted-foreground"}
                      >
                        {line.amountCents < 0 ? "-" : ""}$
                        {(Math.abs(line.amountCents) / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Subtotal</span>
                    <span>${(preview.subtotalCents / 100).toFixed(2)}</span>
                  </div>
                  {preview.hasUnresolvedRules && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-destructive">
                        Not configured — this subtotal is not a final payable total.
                      </p>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground">
                        {preview.unresolvedNotes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Tax and fees: Not configured. A 50% deposit would apply at booking.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Per-guest included-selection picker, grouped by selection category. */
function IncludedChoices({
  pkg,
  guest,
  onToggle,
}: {
  pkg: MealPackageDTO;
  guest: GuestRow;
  onToggle: (cat: SelectionCategory, itemId: string) => void;
}) {
  const eligibleByCat = useMemo(() => {
    const map: Record<SelectionCategory, Array<{ menuItemId: string; menuItemName: string }>> = {
      meat: [],
      side: [],
      bread: [],
      drink: [],
    };
    for (const e of pkg.eligibleItems) {
      if (map[e.selectionCategory as SelectionCategory]) {
        map[e.selectionCategory as SelectionCategory].push({
          menuItemId: e.menuItemId,
          menuItemName: e.menuItemName,
        });
      }
    }
    return map;
  }, [pkg]);

  const expected: Record<string, number> = {
    meat: pkg.includedMeatsCount,
    side: pkg.includedSidesCount,
  };

  const countFor = (cat: string) =>
    guest.includedSelections.filter((s) => s.selectionCategory === cat).length;

  const hasAnyEligible = Object.values(eligibleByCat).some((arr) => arr.length > 0);

  return (
    <div className="space-y-2 rounded-md bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Included choices (covered by the package price)
      </p>
      {!hasAnyEligible && (
        <p className="text-sm text-muted-foreground">
          No eligible dishes configured for this package. Add eligible dishes in the package editor.
        </p>
      )}
      {[...COUNT_CATS, ...OPTIONAL_CATS].map((cat) => {
        const items = eligibleByCat[cat];
        if (items.length === 0) return null;
        const want = expected[cat];
        const have = countFor(cat);
        const isCountCat = cat in expected;
        return (
          <div key={cat} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {SELECTION_CATEGORY_LABELS[cat]}
                {isCountCat && want > 0 ? ` (choose ${want})` : ""}
              </span>
              {isCountCat && want > 0 && (
                <span
                  className={
                    have === want ? "text-xs text-primary" : "text-xs text-muted-foreground"
                  }
                >
                  {have}/{want}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {items.map((item) => {
                const checked = guest.includedSelections.some(
                  (s) => s.menuItemId === item.menuItemId && s.selectionCategory === cat,
                );
                return (
                  <button
                    key={item.menuItemId}
                    type="button"
                    onClick={() => onToggle(cat, item.menuItemId)}
                    className={
                      "rounded-full border px-3 py-1 text-xs transition-colors " +
                      (checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:bg-muted")
                    }
                  >
                    {item.menuItemName}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
