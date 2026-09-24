/**
 * Centralized role and permission definitions.
 *
 * UI permission gates are for PRESENTATION ONLY.
 * Future server functions and database policies must enforce real authorization.
 */
import type { Permission, PermissionKey, Role, RoleKey } from "./types";

export const ROLES: Role[] = [
  {
    key: "guest",
    label: "Guest",
    description: "A registered diner who manages their own reservations and profile.",
  },
  {
    key: "foh_staff",
    label: "Front-of-House Staff",
    description: "Manages check-in, seating, walk-ins, and guest-facing operations.",
  },
  {
    key: "kitchen_staff",
    label: "Kitchen Staff",
    description: "Views meal totals, prep reports, and dietary notes. No financial data.",
  },
  {
    key: "content_manager",
    label: "Content Manager",
    description: "Manages public content, menus, images, and FAQs.",
  },
  {
    key: "ops_manager",
    label: "Operations Manager",
    description: "Manages reservation operations, capacity, payments, and reports.",
  },
  {
    key: "administrator",
    label: "Administrator",
    description: "Manages users, roles, permissions, business rules, and integrations.",
  },
];

export const ROLE_KEYS: RoleKey[] = ROLES.map((r) => r.key);

export const ROLE_LABELS: Record<RoleKey, string> = ROLES.reduce(
  (acc, r) => {
    acc[r.key] = r.label;
    return acc;
  },
  {} as Record<RoleKey, string>,
);

export const PERMISSIONS: Permission[] = [
  {
    key: "account.read_own",
    label: "Read own account",
    category: "Account",
    description: "View own profile and account details.",
  },
  {
    key: "account.update_own",
    label: "Update own account",
    category: "Account",
    description: "Edit own profile and preferences.",
  },
  {
    key: "reservations.read_own",
    label: "Read own reservations",
    category: "Reservations",
    description: "View reservations owned by the user.",
  },
  {
    key: "reservations.read_all",
    label: "Read all reservations",
    category: "Reservations",
    description: "View any reservation in the system.",
  },
  {
    key: "reservations.manage",
    label: "Manage reservations",
    category: "Reservations",
    description: "Create, edit, assign, and update reservations.",
  },
  {
    key: "seating.read",
    label: "Read seating",
    category: "Seating",
    description: "View table and seating layout.",
  },
  {
    key: "seating.manage",
    label: "Manage seating",
    category: "Seating",
    description: "Assign and combine tables.",
  },
  {
    key: "check_in.manage",
    label: "Manage check-in",
    category: "Check-in",
    description: "Check guests in and update arrival status.",
  },
  {
    key: "walk_ins.manage",
    label: "Manage walk-ins",
    category: "Walk-ins",
    description: "Add and seat walk-in guests.",
  },
  {
    key: "waitlist.read",
    label: "Read waitlist",
    category: "Waitlist",
    description: "View waitlist entries.",
  },
  {
    key: "waitlist.manage",
    label: "Manage waitlist",
    category: "Waitlist",
    description: "Invite, convert, or decline waitlist entries.",
  },
  {
    key: "kitchen.read",
    label: "Read kitchen",
    category: "Kitchen",
    description: "View meal totals and dietary notes.",
  },
  {
    key: "kitchen.reports",
    label: "Kitchen reports",
    category: "Kitchen",
    description: "View and produce preparation reports.",
  },
  {
    key: "content.read_drafts",
    label: "Read draft content",
    category: "Content",
    description: "View unpublished content drafts.",
  },
  {
    key: "content.manage",
    label: "Manage content",
    category: "Content",
    description: "Create and edit content, menus, and media.",
  },
  {
    key: "content.publish",
    label: "Publish content",
    category: "Content",
    description: "Publish content and menus to the public site.",
  },
  {
    key: "menus.manage",
    label: "Manage menus",
    category: "Menus",
    description: "Create and edit menus and menu items.",
  },
  {
    key: "availability.manage",
    label: "Manage availability",
    category: "Availability",
    description: "Manage Sundays, seating times, and capacity.",
  },
  {
    key: "pricing.manage",
    label: "Manage pricing",
    category: "Pricing",
    description: "Manage prices, discounts, fees, and taxes.",
  },
  {
    key: "payments.read",
    label: "Read payments",
    category: "Payments",
    description: "View payment status and history.",
  },
  {
    key: "payments.manage",
    label: "Manage payments",
    category: "Payments",
    description: "Record payments, refunds, and adjustments.",
  },
  {
    key: "reports.read",
    label: "Read reports",
    category: "Reports",
    description: "View operating and financial reports.",
  },
  { key: "users.read", label: "Read users", category: "Users", description: "View user accounts." },
  {
    key: "users.manage",
    label: "Manage users",
    category: "Users",
    description: "Create, edit, and deactivate users.",
  },
  {
    key: "roles.manage",
    label: "Manage roles",
    category: "Roles",
    description: "Manage roles and permission assignments.",
  },
  {
    key: "settings.manage",
    label: "Manage settings",
    category: "Settings",
    description: "Manage business rules and application settings.",
  },
  {
    key: "audit.read",
    label: "Read audit log",
    category: "Audit",
    description: "Review audit history.",
  },
  {
    key: "integrations.manage",
    label: "Manage integrations",
    category: "Integrations",
    description: "Manage third-party integrations.",
  },
];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export const PERMISSION_LABELS: Record<PermissionKey, string> = PERMISSIONS.reduce(
  (acc, p) => {
    acc[p.key] = p.label;
    return acc;
  },
  {} as Record<PermissionKey, string>,
);

/**
 * Role → permission mapping. This is the single source of truth for
 * presentation-level permission checks. Server authorization (future phase)
 * must re-derive these server-side, never trust the client.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  guest: ["account.read_own", "account.update_own", "reservations.read_own"],
  foh_staff: [
    "reservations.read_all",
    "reservations.manage",
    "seating.read",
    "seating.manage",
    "check_in.manage",
    "walk_ins.manage",
    "waitlist.read",
  ],
  kitchen_staff: ["kitchen.read", "kitchen.reports"],
  content_manager: ["content.read_drafts", "content.manage", "content.publish", "menus.manage"],
  ops_manager: [
    "reservations.read_all",
    "reservations.manage",
    "seating.read",
    "seating.manage",
    "availability.manage",
    "waitlist.read",
    "waitlist.manage",
    "payments.read",
    "reports.read",
  ],
  administrator: [...PERMISSION_KEYS],
};

/** Returns true when a role holds a given permission (presentation only). */
export function roleHasPermission(roleKey: RoleKey, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[roleKey]?.includes(permission) ?? false;
}
