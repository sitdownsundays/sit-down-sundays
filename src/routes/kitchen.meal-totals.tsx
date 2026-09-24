import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { MOCK_RESERVATIONS } from "@/lib/mock";
import type { ReservationMealSelection } from "@/lib/domain/types";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/kitchen/meal-totals")({
  head: () =>
    internalHead({
      title: "Meal Totals — Kitchen — Sit Down Sundays",
      description: "Aggregated meal totals.",
    }),
  component: MealTotals,
});

function MealTotals() {
  const all = MOCK_RESERVATIONS.flatMap((r) => r.mealSelections);
  const totals = new Map<string, { name: string; qty: number }>();
  for (const m of all) {
    const existing = totals.get(m.menuItemId);
    if (existing) existing.qty += m.quantity;
    else totals.set(m.menuItemId, { name: m.itemNameSnapshot, qty: m.quantity });
  }
  const rows = [...totals.values()].map((t, i) => ({ id: String(i), ...t }));

  const columns: Column<{ id: string; name: string; qty: number }>[] = [
    { key: "name", header: "Item", render: (r) => r.name },
    { key: "qty", header: "Quantity", render: (r) => r.qty },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Kitchen Workspace"
        title="Meal Totals"
        description="Aggregated meal counts across reservations."
      />
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
    </div>
  );
}
