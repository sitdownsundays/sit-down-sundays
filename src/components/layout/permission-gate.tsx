import type { ReactNode } from "react";
import { useMockRole } from "@/lib/mock/mock-role-context";
import { roleHasPermission } from "@/lib/domain/roles";
import type { PermissionKey } from "@/lib/domain/types";

interface PermissionGateProps {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * PRESENTATION ONLY. UI permission gates do not provide security.
 * Future server functions and database policies enforce real authorization.
 */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const role = useMockRole();
  if (!roleHasPermission(role, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
