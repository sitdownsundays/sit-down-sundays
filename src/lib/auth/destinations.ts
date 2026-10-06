/**
 * Shared, client-safe, permission-aware workspace destination helpers.
 *
 * One source of truth for:
 *  - the default workspace a role lands on after sign-in
 *  - the single workspace link shown in the public header for an internal user
 *  - whether a given internal path is authorized for a role
 *  - resolving the post-signin destination from an explicit return path
 *
 * Presentation/routing only. Real authorization is enforced server-side by
 * route guards (requireInternalRole / requireAuth) and server functions.
 * Hiding or redirecting does not secure a route.
 *
 * Client-safe: imports only domain role/permission helpers and the
 * client-safe auth constants — no secrets, no server-only modules.
 */
import type { RoleKey, PermissionKey } from "@/lib/domain/types";
import { roleHasPermission } from "@/lib/domain/roles";
import { isAllowedReturnPath, DEFAULT_POST_SIGNIN_PATH } from "@/lib/auth/constants";

export type WorkspaceArea = "guest" | "staff" | "kitchen" | "admin";

export interface WorkspaceOption {
  area: WorkspaceArea;
  label: string;
  to: string;
  /** Permission required to see/enter this workspace (guest has none). */
  permission?: PermissionKey;
}

/**
 * All workspaces in DISPLAY order (Guest Portal first). Used by the sidebar
 * workspace switcher so the user's own portal always appears first.
 */
export const WORKSPACES: WorkspaceOption[] = [
  { area: "guest", label: "Guest Portal", to: "/account" },
  { area: "staff", label: "Staff Operations", to: "/staff", permission: "reservations.read_all" },
  { area: "kitchen", label: "Kitchen", to: "/kitchen", permission: "kitchen.read" },
  { area: "admin", label: "Administration", to: "/admin", permission: "content.manage" },
];

/**
 * Workspaces in DEFAULT-DESTINATION priority order: Administration first,
 * then Staff, then Kitchen, then Guest Portal. The first workspace a role is
 * permitted to enter becomes that role's default landing destination.
 */
const WORKSPACE_PRIORITY: WorkspaceOption[] = [
  { area: "admin", label: "Administration", to: "/admin", permission: "content.manage" },
  { area: "staff", label: "Staff Operations", to: "/staff", permission: "reservations.read_all" },
  { area: "kitchen", label: "Kitchen", to: "/kitchen", permission: "kitchen.read" },
  { area: "guest", label: "Guest Portal", to: "/account" },
];

function canEnter(role: RoleKey, w: WorkspaceOption): boolean {
  return !w.permission || roleHasPermission(role, w.permission);
}

/**
 * Workspaces a role may see (Guest Portal always; internal workspaces only
 * when the role holds the guarding permission). Display order.
 */
export function visibleWorkspaces(role: RoleKey): WorkspaceOption[] {
  return WORKSPACES.filter((w) => canEnter(role, w));
}

/** True when the role may see at least one internal workspace. */
export function hasInternalWorkspace(role: RoleKey): boolean {
  return visibleWorkspaces(role).some((w) => w.area !== "guest");
}

/**
 * The single primary internal workspace link to show in the public header for
 * a signed-in internal user, in priority order (admin > staff > kitchen).
 * Returns null for guests and unauthenticated users — they get no internal
 * link. Only users permitted to enter Administration see "Administration";
 * other internal users see their own workspace label/link.
 */
export function primaryWorkspaceForRole(role: RoleKey | undefined): WorkspaceOption | null {
  if (!role || role === "guest") return null;
  for (const w of WORKSPACE_PRIORITY) {
    if (w.area === "guest") continue;
    if (canEnter(role, w)) return w;
  }
  return null;
}

/**
 * The default workspace destination for a role: the first permitted internal
 * workspace in priority order, falling back to the Guest Portal (/account).
 *
 *  - administrator      → /admin
 *  - content_manager    → /admin (permitted)
 *  - ops_manager        → /staff (its permitted primary workspace)
 *  - foh_staff          → /staff
 *  - kitchen_staff      → /kitchen
 *  - guest / undefined  → /account
 */
export function defaultWorkspaceForRole(role: RoleKey | undefined): string {
  return primaryWorkspaceForRole(role)?.to ?? DEFAULT_POST_SIGNIN_PATH;
}

/**
 * Whether a role is authorized to enter a given internal path. /account (and
 * its children) are always authorized for any authenticated user. Internal
 * workspace prefixes require the role to hold that workspace's permission.
 */
export function isPathAuthorizedForRole(role: RoleKey | undefined, path: string): boolean {
  if (!role) return false;
  // The Guest Portal is available to every authenticated user.
  if (path === "/account" || path.startsWith("/account/")) return true;
  for (const w of WORKSPACE_PRIORITY) {
    if (w.area === "guest") continue;
    if (path === w.to || path.startsWith(w.to + "/")) {
      return canEnter(role, w);
    }
  }
  return false;
}

/**
 * Resolve the post-signin destination.
 *
 * An explicit return path is used only when it is BOTH sanitized (a valid
 * internal path — rejects external/open-redirect/backslash paths) AND
 * authorized for the signed-in user's role. Otherwise the role's permitted
 * default workspace is used.
 */
export function resolvePostSigninDestination(
  role: RoleKey | undefined,
  returnTo: string | undefined,
): string {
  const hasExplicitReturn = !!returnTo && returnTo.trim() !== "";
  if (hasExplicitReturn) {
    const trimmed = returnTo!.trim();
    if (isAllowedReturnPath(trimmed) && isPathAuthorizedForRole(role, trimmed)) {
      return trimmed;
    }
  }
  return defaultWorkspaceForRole(role);
}
