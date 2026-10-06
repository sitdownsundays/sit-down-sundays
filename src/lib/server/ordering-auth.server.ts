/**
 * SERVER-ONLY — ordering authorization helper.
 *
 * Resolves the CURRENT authenticated Supabase user server-side (via the auth
 * repository's resolveSession, which calls auth.getUser() — never trusting
 * decoded cookie contents) and verifies the role holds menus.manage before
 * any ordering query or mutation. The preview tool allows foh_staff too
 * (read-only) via resolveOrderingPreviewActor.
 *
 * Browser code never imports this. A `callerRole` value received from the
 * browser is NEVER trusted; the only role that reaches the ordering repository
 * is the one resolved here from the live session.
 *
 * menus.manage is held by content_manager, ops_manager, and administrator
 * (see ROLE_PERMISSIONS). This reuses the same permission as the Menu CMS
 * since ordering config is part of Menus & Meals.
 */
import { getAuthRepository } from "./auth-repository.server";
import { roleHasPermission } from "@/lib/domain/roles";
import type { RoleKey } from "@/lib/domain/types";

export interface OrderingActor {
  role: RoleKey;
  userId: string;
}

export class OrderingAuthorizationError extends Error {
  constructor(message = "You are not authorized to manage ordering configuration.") {
    super(message);
    this.name = "OrderingAuthorizationError";
  }
}

/** Resolve the current actor and require menus.manage (mutation roles). */
export async function resolveOrderingActor(): Promise<OrderingActor> {
  const auth = getAuthRepository();
  const session = await auth.resolveSession();
  if (!session.authenticated) throw new OrderingAuthorizationError();
  const role = session.user.roleKey;
  if (!roleHasPermission(role, "menus.manage")) throw new OrderingAuthorizationError();
  return { role, userId: session.user.id };
}

/** Resolve the current actor for the preview tool (allows foh_staff read-only). */
export async function resolveOrderingPreviewActor(): Promise<OrderingActor> {
  const auth = getAuthRepository();
  const session = await auth.resolveSession();
  if (!session.authenticated) throw new OrderingAuthorizationError();
  return { role: session.user.roleKey, userId: session.user.id };
}
