import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { ROLES, ROLE_PERMISSIONS } from "@/lib/domain/roles";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/roles")({
  head: () =>
    internalHead({
      title: "Roles — Admin — Sit Down Sundays",
      description: "Manage roles and permissions.",
    }),
  component: AdminRoles,
});

const rows = ROLES.map((r) => ({
  id: r.key,
  label: r.label,
  description: r.description,
  permissions: ROLE_PERMISSIONS[r.key].length,
}));

const columns: Column<(typeof rows)[number]>[] = [
  { key: "label", header: "Role", render: (r) => r.label },
  { key: "desc", header: "Description", render: (r) => r.description, hideOnMobile: true },
  { key: "perms", header: "Permissions", render: (r) => r.permissions },
];

function AdminRoles() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Roles & Permissions"
        description="Review role definitions and permission counts."
      />
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
    </div>
  );
}
