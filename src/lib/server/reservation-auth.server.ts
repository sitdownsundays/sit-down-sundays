/**
 * SERVER-ONLY — reservation authorization helper.
 *
 * Resolves the CURRENT authenticated Supabase user server-side (via the auth
 * repository's resolveSession, which calls auth.getUser() — never trusting
 * decoded cookie contents or a browser-supplied role) and verifies the role
 * holds reservations.read_all (staff list/detail) before any private
 * reservation read. Public submission does NOT require a session.
 *
 * Browser code never imports this. A `callerRole` value received from the
 * browser is NEVER trusted; the only role that reaches the reservation
 * repository is the one resolved here from the live session.
 *
 * reservations.read_all is held by foh_staff, ops_manager, and administrator
 * (see ROLE_PERMISSIONS). reservations.manage adds mutation rights.
 */
import { getAuthRepository } from "./auth-repository.server";
import { roleHasPermission } from "@/lib/domain/roles";
import type { RoleKey } from "@/lib/domain/types";

export interface ReservationActor {
  role: RoleKey;
  userId: string;
}

export class ReservationAuthorizationError extends Error {
  constructor(message = "You are not authorized to view reservations.") {
    super(message);
    this.name = "ReservationAuthorizationError";
  }
}

/**
 * Resolve the current actor and require reservations.read_all (staff read).
 * Used by staff list/detail server functions. Public submission does not
 * call this — it is an unauthenticated public flow.
 */
export async function resolveReservationStaffActor(): Promise<ReservationActor> {
  const auth = getAuthRepository();
  const session = await auth.resolveSession();
  if (!session.authenticated) throw new ReservationAuthorizationError();
  const role = session.user.roleKey;
  if (!roleHasPermission(role, "reservations.read_all")) {
    throw new ReservationAuthorizationError();
  }
  return { role, userId: session.user.id };
}
