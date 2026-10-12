/**
 * Admin ordering configuration screen.
 *
 * Tabs: Packages | Add-ons | Platters | Pricing rules | Preview an order.
 * All mutations go through authorized server functions with optimistic
 * concurrency and a synchronous double-submit lock.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState } from "@/components/layout/loading-state";
import { ErrorState } from "@/components/layout/error-state";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { getOrderingConfig } from "@/lib/ordering.functions";
import type {
  MealPackageDTO,
  IndividualAddonDTO,
  SharedPlatterDTO,
  OrderingConfigDTO,
} from "@/lib/ordering/types";
import { PackageDialog } from "./ordering-package-dialog";
import { AddonDialog } from "./ordering-addon-dialog";
import { PlatterDialog } from "./ordering-platter-dialog";
import { RulesTab } from "./ordering-rules-tab";
import { OrderPreview } from "./order-preview";
import { centsToDollars } from "./ordering-helpers";
import type { PricingReloadResult } from "./package-pricing-helpers";

type DialogState =
  | { kind: "package-create" }
  | { kind: "package-edit"; item: MealPackageDTO }
  | { kind: "addon-create" }
  | { kind: "addon-edit"; item: IndividualAddonDTO }
  | { kind: "platter-create" }
  | { kind: "platter-edit"; item: SharedPlatterDTO }
  | null;

export function AdminOrderingPage() {
  const queryClient = useQueryClient();
  const actionLockRef = useRef(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [activeTab, setActiveTab] = useState("packages");

  const configQuery = useQuery({
    queryKey: ["ordering-config"],
    queryFn: async () => {
      const res = await getOrderingConfig();
      return res.ok ? res.config : null;
    },
  });

  async function reload() {
    await queryClient.invalidateQueries({ queryKey: ["ordering-config"] });
    await configQuery.refetch();
  }

  /** Fresh-read result for pricing-recovery validation. Returns the actual
   *  returned configuration only when the server read succeeded; never
   *  falls back to cached data. */
  async function reloadPricingConfig(): Promise<
    { ok: true; config: OrderingConfigDTO } | { ok: false }
  > {
    await queryClient.invalidateQueries({ queryKey: ["ordering-config"] });
    const res = await configQuery.refetch();
    if (res.isError || !res.data) return { ok: false };
    return { ok: true, config: res.data };
  }

  /** Fresh-read recovery for a single package's pricing. Returns the actual
   *  package from the server read — never cached/fallback data. Missing or
   *  mismatched packages must NOT clear the recovery gate. */
  async function reloadPricingPackage(packageId: string): Promise<PricingReloadResult> {
    const res = await reloadPricingConfig();
    if (!res.ok) return { ok: false, pkg: null };
    const pkg = res.config.packages.find((p) => p.id === packageId) ?? null;
    return { ok: true, pkg };
  }

  if (configQuery.isLoading) return <LoadingState label="Loading ordering configuration…" />;
  if (configQuery.isError)
    return (
      <ErrorState
        title="Couldn't load ordering configuration"
        message="Something went wrong while loading the configuration."
        action={
          <Button variant="outline" onClick={() => reload()}>
            Try again
          </Button>
        }
      />
    );
  const config: OrderingConfigDTO | null = configQuery.data ?? null;
  if (!config)
    return (
      <EmptyState
        title="Ordering configuration unavailable"
        description="No ordering configuration was returned. This may indicate the ordering migration has not been applied yet, or the server could not reach the database."
        action={
          <Button variant="outline" onClick={() => reload()}>
            Try again
          </Button>
        }
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ordering Configuration"
        description="Meal packages, individual add-ons, shared platters, and guest pricing rules. These power the order preview and future checkout."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="addons">Add-ons</TabsTrigger>
          <TabsTrigger value="platters">Platters</TabsTrigger>
          <TabsTrigger value="rules">Pricing rules</TabsTrigger>
          <TabsTrigger value="preview">Preview an order</TabsTrigger>
        </TabsList>

        {/* Packages */}
        <TabsContent value="packages" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Packages are priced per person and cover their included selection counts.
            </p>
            <Button onClick={() => setDialog({ kind: "package-create" })}>New package</Button>
          </div>
          {config.packages.length === 0 ? (
            <EmptyState title="No packages yet" description="Create your first meal package." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Price/person</th>
                    <th className="p-3 font-medium">Meats</th>
                    <th className="p-3 font-medium">Sides</th>
                    <th className="p-3 font-medium">Active</th>
                    <th className="p-3 font-medium">Order</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {config.packages.map((pkg) => (
                    <tr key={pkg.id} className="border-t border-border">
                      <td className="p-3 font-medium text-foreground">{pkg.name}</td>
                      <td className="p-3 text-muted-foreground">
                        ${centsToDollars(pkg.pricePerPersonCents)}
                      </td>
                      <td className="p-3 text-muted-foreground">{pkg.includedMeatsCount}</td>
                      <td className="p-3 text-muted-foreground">{pkg.includedSidesCount}</td>
                      <td className="p-3">{pkg.isActive ? "Yes" : "No"}</td>
                      <td className="p-3 text-muted-foreground">{pkg.displayOrder}</td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDialog({ kind: "package-edit", item: pkg })}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Add-ons */}
        <TabsContent value="addons" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Individual add-ons are priced per unit and attached to one guest.
            </p>
            <Button onClick={() => setDialog({ kind: "addon-create" })}>New add-on</Button>
          </div>
          {config.addons.length === 0 ? (
            <EmptyState title="No add-ons yet" description="Create your first individual add-on." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Price/unit</th>
                    <th className="p-3 font-medium">Eligible packages</th>
                    <th className="p-3 font-medium">Active</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {config.addons.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="p-3 font-medium text-foreground">{a.name}</td>
                      <td className="p-3 text-muted-foreground">${centsToDollars(a.priceCents)}</td>
                      <td className="p-3 text-muted-foreground">
                        {a.eligiblePackageIds.length === 0
                          ? "All packages"
                          : `${a.eligiblePackageIds.length} package(s)`}
                      </td>
                      <td className="p-3">{a.isActive ? "Yes" : "No"}</td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDialog({ kind: "addon-edit", item: a })}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Platters */}
        <TabsContent value="platters" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Shared platters are priced per platter and belong to the party order.
            </p>
            <Button onClick={() => setDialog({ kind: "platter-create" })}>New platter</Button>
          </div>
          {config.platters.length === 0 ? (
            <EmptyState title="No platters yet" description="Create your first shared platter." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Price/platter</th>
                    <th className="p-3 font-medium">Active</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {config.platters.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="p-3 font-medium text-foreground">{p.name}</td>
                      <td className="p-3 text-muted-foreground">
                        ${centsToDollars(p.pricePerPlatterCents)}
                      </td>
                      <td className="p-3">{p.isActive ? "Yes" : "No"}</td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDialog({ kind: "platter-edit", item: p })}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Pricing rules */}
        <TabsContent value="rules">
          <RulesTab
            config={config}
            actionLockRef={actionLockRef}
            onReload={reload}
            onPricingReload={reloadPricingPackage}
          />
        </TabsContent>

        {/* Preview */}
        <TabsContent value="preview">
          <OrderPreview />
        </TabsContent>
      </Tabs>

      {dialog?.kind === "package-create" && (
        <PackageDialog
          mode="create"
          actionLockRef={actionLockRef}
          onClose={() => setDialog(null)}
          onSaved={reload}
          goToRules={() => {
            setDialog(null);
            setActiveTab("rules");
          }}
        />
      )}
      {dialog?.kind === "package-edit" && (
        <PackageDialog
          mode="edit"
          existing={dialog.item}
          actionLockRef={actionLockRef}
          onClose={() => setDialog(null)}
          onSaved={reload}
          goToRules={() => {
            setDialog(null);
            setActiveTab("rules");
          }}
        />
      )}
      {dialog?.kind === "addon-create" && (
        <AddonDialog
          mode="create"
          packages={config.packages}
          actionLockRef={actionLockRef}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      )}
      {dialog?.kind === "addon-edit" && (
        <AddonDialog
          mode="edit"
          existing={dialog.item}
          packages={config.packages}
          actionLockRef={actionLockRef}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      )}
      {dialog?.kind === "platter-create" && (
        <PlatterDialog
          mode="create"
          actionLockRef={actionLockRef}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      )}
      {dialog?.kind === "platter-edit" && (
        <PlatterDialog
          mode="edit"
          existing={dialog.item}
          actionLockRef={actionLockRef}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
