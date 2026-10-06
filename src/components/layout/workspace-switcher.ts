/**
 * Permission-aware workspace switcher — re-exports the shared, client-safe
 * destination helpers from @/lib/auth/destinations so layout components keep
 * a stable import path. The canonical definitions live in one place.
 */
export {
  WORKSPACES,
  visibleWorkspaces,
  hasInternalWorkspace,
  type WorkspaceArea,
  type WorkspaceOption,
} from "@/lib/auth/destinations";
