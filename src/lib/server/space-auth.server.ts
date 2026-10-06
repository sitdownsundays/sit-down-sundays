/**
 * SERVER-ONLY — venue spaces authorization helper.
 *
 * Resolves the CURRENT authenticated Supabase user server-side (via the auth
 * repository's resolveSession, which calls auth.getUser() — never trusting
 * decoded cookie contents) and verifies the role holds availability.manage
 * before any space query or mutation.
 *
 * Browser code never imports this. A `callerRole` value received from the
 * browser is NEVER trusted; the only role that reaches the space repository
 * is the one resolved here from the live session.
 *
 * availability.manage is held by ops_manager and administrator (see
 * ROLE_PERMISSIONS). content_manager and foh_staff do NOT hold it, so they
 * cannot list or edit spaces.
 */
import { getAuthRepository } from "./auth-repository.server";
import { roleHasPermission } from "@/lib/domain/roles";
import type { RoleKey } from "@/lib/domain/types";

export interface SpaceActor {
  role: RoleKey;
  userId: string;
}

export class SpaceAuthorizationError extends Error {
  constructor(message = "You are not authorized to manage venue spaces.") {
    super(message);
    this.name = "SpaceAuthorizationError";
  }
}

/**
 * Resolve the current authenticated actor and require availability.manage.
 * Throws SpaceAuthorizationError when unauthenticated or the role lacks
 * availability.manage.
 */
export async function resolveSpaceActor(): Promise<SpaceActor> {
  const auth = getAuthRepository();
  const session = await auth.resolveSession();
  if (!session.authenticated) {
    throw new SpaceAuthorizationError();
  }
  const role = session.user.roleKey;
  if (!roleHasPermission(role, "availability.manage")) {
    throw new SpaceAuthorizationError();
  }
  return { role, userId: session.user.id };
}
