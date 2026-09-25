/**
 * SERVER-ONLY — menu CMS authorization helper.
 *
 * Resolves the CURRENT authenticated Supabase user server-side (via the auth
 * repository's resolveSession, which calls auth.getUser() — never trusting
 * decoded cookie contents) and returns the verified role + user id.
 *
 * Browser code never imports this. A `callerRole` value received from the
 * browser is NEVER trusted; the only role that reaches the menu repository
 * is the one resolved here from the live session.
 */
import { getAuthRepository } from "./auth-repository.server";
import type { RoleKey } from "@/lib/domain/types";

export interface MenuActor {
  role: RoleKey;
  userId: string;
}

/**
 * Resolve the current authenticated actor for a CMS operation.
 * Returns null when there is no authenticated session.
 */
export async function resolveMenuActor(): Promise<MenuActor | null> {
  const auth = getAuthRepository();
  const session = await auth.resolveSession();
  if (!session.authenticated) return null;
  return { role: session.user.roleKey, userId: session.user.id };
}
