/**
 * Route guard helpers.
 *
 * These run in beforeLoad and read the session from router context (resolved
 * server-side by the root beforeLoad). They are PRESENTATION/ROUTING guards
 * only — real authorization is enforced by server functions and database
 * policies. Hiding a route does not secure it.
 */
import { redirect } from "@tanstack/react-router";
import type { SessionState } from "@/lib/auth/types";
import { sanitizeReturnPath } from "@/lib/auth/constants";
import type { RoleKey } from "@/lib/domain/types";

/**
 * Require an authenticated session. Redirects to /sign-in with a safe return
 * path when unauthenticated. Blocks suspended/archived profiles.
 */
export function requireAuth(session: SessionState, returnTo: string) {
  if (!session.authenticated) {
    throw redirect({
      to: "/sign-in",
      search: { redirect: sanitizeReturnPath(returnTo) },
    });
  }
  const { status } = session.user;
  if (status === "suspended" || status === "archived") {
    throw redirect({ to: "/sign-in", search: { blocked: "true" } });
  }
  return session.user;
}

/**
 * Require an authenticated session holding one of the allowed internal roles.
 * Guests are redirected to /account. Unauthenticated users go to /sign-in.
 */
export function requireInternalRole(
  session: SessionState,
  allowedRoles: RoleKey[],
  returnTo: string,
) {
  if (!session.authenticated) {
    throw redirect({
      to: "/sign-in",
      search: { redirect: sanitizeReturnPath(returnTo) },
    });
  }
  const { status, roleKey } = session.user;
  if (status === "suspended" || status === "archived") {
    throw redirect({ to: "/sign-in", search: { blocked: "true" } });
  }
  if (!allowedRoles.includes(roleKey)) {
    throw redirect({ to: "/account" });
  }
  return session.user;
}

/** Internal staff roles (everyone except guest). */
export const INTERNAL_ROLES: RoleKey[] = [
  "foh_staff",
  "kitchen_staff",
  "content_manager",
  "ops_manager",
  "administrator",
];
