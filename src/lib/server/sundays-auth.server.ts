/**
 * SERVER-ONLY — Sundays & Seating authorization helper.
 *
 * Resolves the CURRENT authenticated Supabase user server-side (via the auth
 * repository's resolveSession, which calls auth.getUser() — never trusting
 * decoded cookie contents) and verifies the role holds availability.manage
 * before any Sunday-service / seating-time / payment-policy query or mutation.
 *
 * Browser code never imports this. A `callerRole` value received from the
 * browser is NEVER trusted; the only role that reaches the repository is the
 * one resolved here from the live session.
 *
 * availability.manage is held by ops_manager and administrator (see
 * ROLE_PERMISSIONS). content_manager and foh_staff do NOT hold it, so they
 * cannot list or edit Sunday services or seating times.
 */
import { getAuthRepository } from "./auth-repository.server";
import { roleHasPermission } from "@/lib/domain/roles";
import type { RoleKey, PermissionKey } from "@/lib/domain/types";

export interface SundaysActor {
  role: RoleKey;
  userId: string;
}

export class SundaysAuthorizationError extends Error {
  constructor(message = "You are not authorized to manage Sundays and seating.") {
    super(message);
    this.name = "SundaysAuthorizationError";
  }
}

/**
 * Resolve the current authenticated actor and require availability.manage.
 * Throws SundaysAuthorizationError when unauthenticated or the role lacks
 * availability.manage.
 */
export async function resolveSundaysActor(): Promise<SundaysActor> {
  const auth = getAuthRepository();
  const session = await auth.resolveSession();
  if (!session.authenticated) {
    throw new SundaysAuthorizationError();
  }
  const role = session.user.roleKey;
  if (!roleHasPermission(role, "availability.manage")) {
    throw new SundaysAuthorizationError();
  }
  return { role, userId: session.user.id };
}

/**
 * Resolve the current authenticated actor and require the given permission.
 * Used for dining-table management which is gated by seating.read /
 * seating.manage (distinct from the availability.manage used for Sunday
 * services and seating times).
 */
export async function resolveSundaysActorWithPermission(
  permission: PermissionKey,
): Promise<SundaysActor> {
  const auth = getAuthRepository();
  const session = await auth.resolveSession();
  if (!session.authenticated) {
    throw new SundaysAuthorizationError();
  }
  const role = session.user.roleKey;
  if (!roleHasPermission(role, permission)) {
    throw new SundaysAuthorizationError();
  }
  return { role, userId: session.user.id };
}
