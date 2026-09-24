import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { MOCK_MENU_ITEMS } from "@/lib/mock";
import { CurrencyDisplay } from "@/components/layout/currency-display";
import type { MenuItem } from "@/lib/domain/types";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/menu-items")({
  head: () =>
    internalHead({
      title: "Menu Items — Admin — Sit Down Sundays",
      description: "Manage menu items.",
    }),
  component: AdminMenuItems,
});

const columns: Column<MenuItem>[] = [
  { key: "name", header: "Name", render: (i) => i.name },
  { key: "category", header: "Category", render: (i) => i.category, hideOnMobile: true },
  { key: "price", header: "Price", render: (i) => <CurrencyDisplay cents={i.priceCents} /> },
  {
    key: "avail",
    header: "Available",
    render: (i) => (i.available ? "Yes" : "No"),
    hideOnMobile: true,
  },
];

function AdminMenuItems() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Menu Items"
        description="Manage individual menu items and prices."
      />
      <DataTable columns={columns} rows={MOCK_MENU_ITEMS} rowKey={(i) => i.id} />
    </div>
  );
}
