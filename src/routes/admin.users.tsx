import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Column } from "@/components/layout/data-table";
import { MOCK_USERS } from "@/lib/mock";
import { ROLE_LABELS } from "@/lib/domain/roles";
import type { User } from "@/lib/domain/types";
import { internalHead } from "@/lib/head-meta";

export const Route = createFileRoute("/admin/users")({
  head: () =>
    internalHead({ title: "Users — Admin — Sit Down Sundays", description: "Manage users." }),
  component: AdminUsers,
});

const columns: Column<User>[] = [
  { key: "name", header: "Name", render: (u) => u.displayName },
  { key: "email", header: "Email", render: (u) => u.email, hideOnMobile: true },
  { key: "role", header: "Role", render: (u) => ROLE_LABELS[u.roleKey] },
];

function AdminUsers() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Manage user accounts and roles."
      />
      <DataTable columns={columns} rows={MOCK_USERS} rowKey={(u) => u.id} />
    </div>
  );
}
