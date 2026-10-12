/**
 * Shared active-role resolution.
 *
 * In mock mode the development role preview drives UI gates.
 * In Supabase mode the authenticated session user's roleKey is
 * authoritative; never fall back to a mock administrator.
 *
 * This is PRESENTATION ONLY. Server-side authorization remains
 * the source of truth for every mutation.
 */
import { useAuth, useSessionUser } from "@/lib/auth/auth-context";
import { useMockRole } from "@/lib/mock/mock-role-context";
import type { RoleKey } from "@/lib/domain/types";

export function useActiveRole(): RoleKey {
  const { dataMode } = useAuth();
  const sessionUser = useSessionUser();
  const mockRole = useMockRole();
  if (dataMode === "mock") return mockRole;
  return sessionUser?.roleKey ?? "guest";
}
