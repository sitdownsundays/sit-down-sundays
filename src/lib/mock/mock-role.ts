/**
 * Development-only role preview.
 *
 * MOCK FUNCTIONALITY — NOT SECURITY.
 * This simulates an "active role" for previewing internal layouts in dev.
 * It is isolated under the mock-data layer and must NOT appear in production.
 * It is removable without rewriting the UI.
 */
import type { RoleKey } from "../domain";
import { ROLE_KEYS } from "../domain";

const STORAGE_KEY = "sds_mock_role";

/** Returns a mock role for presentation only. Defaults to "guest". */
export function getMockRole(): RoleKey {
  if (typeof window === "undefined") return "guest";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && (ROLE_KEYS as string[]).includes(v)) return v as RoleKey;
  } catch {
    /* ignore */
  }
  return "guest";
}

export function setMockRole(role: RoleKey): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, role);
  } catch {
    /* ignore */
  }
}

export const MOCK_ROLE_LABEL = "Mock role preview — development only, not security";
