import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { internalHead } from "@/lib/head-meta";
import { useSessionUser } from "@/lib/auth/auth-context";
import { roleHasPermission } from "@/lib/domain/roles";
import {
  BookOpen,
  LayoutList,
  UtensilsCrossed,
  CalendarDays,
  Clock,
  Armchair,
  Receipt,
  Users,
  Shield,
  Settings,
  Plug,
  ScrollText,
  Building2,
} from "lucide-react";

export const Route = createFileRoute("/admin/")({
  head: () =>
    internalHead({
      title: "Admin Dashboard — Sit Down Sundays",
      description: "Administration dashboard.",
    }),
  component: AdminDashboard,
});

interface ModuleCardProps {
  to: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  available: boolean;
}

function ModuleCard({ to, label, description, icon, available }: ModuleCardProps) {
  if (!available) {
    return (
      <div className="flex flex-col rounded-lg border border-dashed border-border bg-card p-5 opacity-80">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground" aria-hidden>
            {icon}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Coming soon
          </span>
        </div>
        <h3 className="mt-3 font-display text-lg font-semibold text-foreground">{label}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    );
  }
  return (
    <Link
      to={to as never}
      className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between">
        <span className="text-primary" aria-hidden>
          {icon}
        </span>
      </div>
      <h3 className="mt-3 font-display text-lg font-semibold text-foreground">{label}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}

function AdminDashboard() {
  const sessionUser = useSessionUser();
  const role = sessionUser?.roleKey ?? "guest";
  const can = (perm: Parameters<typeof roleHasPermission>[1]) => roleHasPermission(role, perm);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Dashboard"
        description="Manage menus, operations, and platform settings — grouped by workflow area."
      />

      {/* Overview is this page. */}

      {/* Reservations */}
      <section aria-labelledby="reservations-heading">
        <h2
          id="reservations-heading"
          className="mb-4 font-display text-xl font-semibold text-foreground"
        >
          Reservations
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ModuleCard
            to="/admin/reservations"
            label="Reservations"
            description="Review guest reservations, meal orders, and table assignments."
            icon={<BookOpen className="size-5" />}
            available={false}
          />
          <ModuleCard
            to="/admin/payments"
            label="Payments"
            description="Track deposits and remaining balances."
            icon={<Receipt className="size-5" />}
            available={false}
          />
        </div>
      </section>

      {/* Menus & Meals */}
      <section aria-labelledby="menus-meals-heading">
        <div className="mb-4">
          <h2
            id="menus-meals-heading"
            className="font-display text-xl font-semibold text-foreground"
          >
            Menus & Meals
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create menus, organize sections, manage dishes, and curate the feast showcase.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ModuleCard
            to="/admin/menus"
            label="Menus"
            description="Create, edit, publish, and archive menus — including sections and items."
            icon={<BookOpen className="size-5" />}
            available={can("menus.manage")}
          />
          <ModuleCard
            to="/admin/menus"
            label="Sections"
            description="Organize menu sections and ordering. Managed within each menu."
            icon={<LayoutList className="size-5" />}
            available={can("menus.manage")}
          />
          <ModuleCard
            to="/admin/menu-items"
            label="Feast Offerings"
            description="Manage Choose Your Feast showcase cards and cover images."
            icon={<UtensilsCrossed className="size-5" />}
            available={can("menus.manage")}
          />
        </div>
      </section>

      {/* Sundays & Seating */}
      <section aria-labelledby="sundays-seating-heading">
        <div className="mb-4">
          <h2
            id="sundays-seating-heading"
            className="font-display text-xl font-semibold text-foreground"
          >
            Sundays & Seating
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure venue spaces, services, seating times, and capacity.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ModuleCard
            to="/admin/spaces"
            label="Venue Spaces"
            description="Manage physical rooms and booking limits. Setting a limit does not open bookings until services and seating times are configured."
            icon={<Building2 className="size-5" />}
            available={can("availability.manage")}
          />
          <ModuleCard
            to="/admin/sundays"
            label="Sundays"
            description="Manage Sunday service availability."
            icon={<CalendarDays className="size-5" />}
            available={false}
          />
          <ModuleCard
            to="/admin/seating-times"
            label="Seating times"
            description="Manage seating times per service."
            icon={<Clock className="size-5" />}
            available={false}
          />
          <ModuleCard
            to="/admin/tables"
            label="Tables & capacity"
            description="Manage table layouts and seating capacity."
            icon={<Armchair className="size-5" />}
            available={false}
          />
        </div>
      </section>

      {/* Settings */}
      <section aria-labelledby="settings-heading">
        <h2
          id="settings-heading"
          className="mb-4 font-display text-xl font-semibold text-foreground"
        >
          Settings
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ModuleCard
            to="/admin/pricing"
            label="Pricing"
            description="Manage pricing, discounts, fees, and taxes."
            icon={<Receipt className="size-5" />}
            available={false}
          />
          <ModuleCard
            to="/admin/users"
            label="Users"
            description="Manage user accounts."
            icon={<Users className="size-5" />}
            available={false}
          />
          <ModuleCard
            to="/admin/roles"
            label="Roles & permissions"
            description="Manage roles and permissions."
            icon={<Shield className="size-5" />}
            available={false}
          />
          <ModuleCard
            to="/admin/settings"
            label="Settings"
            description="Business rules, payment terms, and configuration."
            icon={<Settings className="size-5" />}
            available={false}
          />
          <ModuleCard
            to="/admin/integrations"
            label="Integrations"
            description="Manage third-party integrations."
            icon={<Plug className="size-5" />}
            available={false}
          />
          <ModuleCard
            to="/admin/audit-log"
            label="Audit log"
            description="Review sensitive change history."
            icon={<ScrollText className="size-5" />}
            available={false}
          />
        </div>
      </section>

      <p className="text-center text-xs text-muted-foreground">
        Operational modules are labeled “Coming soon.” Live reservation, payment, and capacity data
        will appear once those workflows are built.
      </p>
    </div>
  );
}
