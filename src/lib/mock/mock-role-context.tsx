import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { RoleKey } from "@/lib/domain";
import { ROLE_KEYS } from "@/lib/domain";
import { getMockRole, setMockRole, MOCK_ROLE_LABEL } from "@/lib/mock/mock-role";

interface MockRoleContextValue {
  role: RoleKey;
  setRole: (role: RoleKey) => void;
  isMock: true;
  label: string;
}

const MockRoleContext = createContext<MockRoleContextValue | null>(null);

export function MockRoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<RoleKey>("guest");

  useEffect(() => {
    setRoleState(getMockRole());
  }, []);

  const setRole = useCallback((next: RoleKey) => {
    setRoleState(next);
    setMockRole(next);
  }, []);

  const value = useMemo<MockRoleContextValue>(
    () => ({ role, setRole, isMock: true, label: MOCK_ROLE_LABEL }),
    [role, setRole],
  );

  return <MockRoleContext.Provider value={value}>{children}</MockRoleContext.Provider>;
}

export function useMockRole(): RoleKey {
  const ctx = useContext(MockRoleContext);
  return ctx?.role ?? "guest";
}

export function useMockRoleContext(): MockRoleContextValue {
  const ctx = useContext(MockRoleContext);
  if (!ctx) {
    return {
      role: "guest",
      setRole: () => {},
      isMock: true,
      label: MOCK_ROLE_LABEL,
    };
  }
  return ctx;
}

export { ROLE_KEYS };
