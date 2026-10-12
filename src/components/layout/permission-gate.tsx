import type { ReactNode } from "react";
import { useActiveRole } from "@/lib/domain/active-role";
import { roleHasPermission } from "@/lib/domain/roles";
import type { PermissionKey } from "@/lib/domain/types";

interface PermissionGateProps {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * PRESENTATION ONLY. UI permission gates do not provide security.
 * Server functions and database policies enforce real authorization.
 *
 * In Supabase mode the role comes from the authenticated session user;
 * never fall back to a mock administrator. In mock mode the
 * development-only role preview drives UI gates.
 */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const role = useActiveRole();
  if (!roleHasPermission(role, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
