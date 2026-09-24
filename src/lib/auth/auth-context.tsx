/**
 * Client-side auth context.
 *
 * Calls the getSession server function and exposes the non-sensitive
 * SessionState to the UI. Never holds tokens — only the SessionUser.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSession, getAuthPublicConfig } from "@/lib/auth.functions";
import type { SessionState } from "@/lib/auth/types";

interface AuthContextValue {
  session: SessionState;
  loading: boolean;
  /** Re-fetch the session from the server (e.g. after sign-in). */
  refresh: () => Promise<void>;
  /** Public data-mode label (for mock-mode gating). */
  dataMode: "mock" | "supabase";
}

const AuthContext = createContext<AuthContextValue | null>(null);

const UNAUTHENTICATED: SessionState = { authenticated: false };

export function AuthProvider({ children }: { children: ReactNode }) {
  const fetchSession = useServerFn(getSession);
  const fetchConfig = useServerFn(getAuthPublicConfig);
  const [session, setSession] = useState<SessionState>(UNAUTHENTICATED);
  const [loading, setLoading] = useState(true);
  const [dataMode, setDataMode] = useState<"mock" | "supabase">("supabase");

  const refresh = useCallback(async () => {
    try {
      const res = await fetchSession();
      if (res.ok) setSession(res.session);
      else setSession(UNAUTHENTICATED);
    } catch {
      setSession(UNAUTHENTICATED);
    } finally {
      setLoading(false);
    }
  }, [fetchSession]);

  useEffect(() => {
    void refresh();
    void fetchConfig().then((c) => setDataMode(c.dataMode));
  }, [refresh, fetchConfig]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, refresh, dataMode }),
    [session, loading, refresh, dataMode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      session: UNAUTHENTICATED,
      loading: false,
      refresh: async () => {},
      dataMode: "supabase",
    };
  }
  return ctx;
}

/** Convenience: the signed-in user, or null. */
export function useSessionUser() {
  const { session } = useAuth();
  return session.authenticated ? session.user : null;
}
