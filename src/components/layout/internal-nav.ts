import type { RoleKey, PermissionKey } from "@/lib/domain";
import { roleHasPermission } from "@/lib/domain/roles";

export interface NavItem {
  label: string;
  to: string;
  icon?: string;
  permission?: PermissionKey;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** Returns nav items filtered by the role's permissions (presentation only). */
export function filterNavByRole(sections: NavSection[], role: RoleKey): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || roleHasPermission(role, item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

export const GUEST_NAV: NavSection[] = [
  {
    label: "My Account",
    items: [
      { label: "Overview", to: "/account" },
      { label: "Reservations", to: "/account/reservations", permission: "reservations.read_own" },
      { label: "Payments", to: "/account/payments" },
      { label: "Profile", to: "/account/profile", permission: "account.update_own" },
      { label: "Support", to: "/account/support" },
    ],
  },
];

export const STAFF_NAV: NavSection[] = [
  {
    label: "Operations",
    items: [
      { label: "Dashboard", to: "/staff" },
      { label: "Reservations", to: "/staff/reservations", permission: "reservations.read_all" },
      { label: "Calendar", to: "/staff/calendar", permission: "availability.manage" },
      { label: "Seating", to: "/staff/seating", permission: "seating.read" },
      { label: "Check-In", to: "/staff/check-in", permission: "check_in.manage" },
      { label: "Walk-Ins", to: "/staff/walk-ins", permission: "walk_ins.manage" },
      { label: "Waitlist", to: "/staff/waitlist", permission: "waitlist.read" },
      { label: "Guest Requests", to: "/staff/guest-requests" },
      { label: "Communications", to: "/staff/communications" },
    ],
  },
];

export const KITCHEN_NAV: NavSection[] = [
  {
    label: "Kitchen",
    items: [
      { label: "Workspace", to: "/kitchen" },
      { label: "Preparation", to: "/kitchen/preparation", permission: "kitchen.read" },
      { label: "Meal Totals", to: "/kitchen/meal-totals", permission: "kitchen.read" },
      { label: "Dietary Notes", to: "/kitchen/dietary-notes", permission: "kitchen.read" },
      { label: "Reports", to: "/kitchen/reports", permission: "kitchen.reports" },
    ],
  },
];

export const ADMIN_NAV: NavSection[] = [
  {
    label: "Content",
    items: [
      { label: "Dashboard", to: "/admin" },
      { label: "Content", to: "/admin/content", permission: "content.manage" },
      { label: "Navigation", to: "/admin/navigation", permission: "content.manage" },
      { label: "Media", to: "/admin/media", permission: "content.manage" },
      { label: "Menus", to: "/admin/menus", permission: "menus.manage" },
      { label: "Menu Items", to: "/admin/menu-items", permission: "menus.manage" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Sundays", to: "/admin/sundays", permission: "availability.manage" },
      { label: "Seating Times", to: "/admin/seating-times", permission: "availability.manage" },
      { label: "Tables", to: "/admin/tables", permission: "seating.manage" },
      { label: "Private Room", to: "/admin/private-room", permission: "availability.manage" },
      { label: "Reservations", to: "/admin/reservations", permission: "reservations.read_all" },
      { label: "Payments", to: "/admin/payments", permission: "payments.read" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Pricing", to: "/admin/pricing", permission: "pricing.manage" },
      { label: "Discounts", to: "/admin/discounts", permission: "pricing.manage" },
      { label: "Fees", to: "/admin/fees", permission: "pricing.manage" },
      { label: "Taxes", to: "/admin/taxes", permission: "pricing.manage" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Emails", to: "/admin/emails", permission: "content.manage" },
      { label: "Reports", to: "/admin/reports", permission: "reports.read" },
      { label: "Users", to: "/admin/users", permission: "users.read" },
      { label: "Roles", to: "/admin/roles", permission: "roles.manage" },
      { label: "Settings", to: "/admin/settings", permission: "settings.manage" },
      { label: "Integrations", to: "/admin/integrations", permission: "integrations.manage" },
      { label: "Audit Log", to: "/admin/audit-log", permission: "audit.read" },
    ],
  },
];

export const AREA_NAV: Record<"guest" | "staff" | "kitchen" | "admin", NavSection[]> = {
  guest: GUEST_NAV,
  staff: STAFF_NAV,
  kitchen: KITCHEN_NAV,
  admin: ADMIN_NAV,
};
