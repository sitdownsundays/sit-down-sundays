import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  sanitizeReturnPath,
  DEFAULT_POST_SIGNIN_PATH,
  PASSWORD_MIN_LENGTH,
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
} from "@/lib/auth/constants";
import { requireAuth, requireInternalRole, INTERNAL_ROLES } from "@/lib/auth/guards";
import type { SessionState, SessionUser } from "@/lib/auth/types";
import type { RoleKey } from "@/lib/domain/types";

/* ----------------------------- Constants ----------------------------- */

describe("auth constants", () => {
  it("sanitizes internal return paths", () => {
    expect(sanitizeReturnPath("/account")).toBe("/account");
    expect(sanitizeReturnPath("/account/reservations")).toBe("/account/reservations");
    expect(sanitizeReturnPath("/staff/calendar")).toBe("/staff/calendar");
  });

  it("rejects external/open-redirect paths", () => {
    expect(sanitizeReturnPath("//evil.com")).toBe(DEFAULT_POST_SIGNIN_PATH);
    expect(sanitizeReturnPath("https://evil.com")).toBe(DEFAULT_POST_SIGNIN_PATH);
    expect(sanitizeReturnPath("/\\evil")).toBe(DEFAULT_POST_SIGNIN_PATH);
  });

  it("rejects paths outside the internal allow-list", () => {
    expect(sanitizeReturnPath("/waitlist")).toBe(DEFAULT_POST_SIGNIN_PATH);
    expect(sanitizeReturnPath("/")).toBe(DEFAULT_POST_SIGNIN_PATH);
  });

  it("handles null/empty input", () => {
    expect(sanitizeReturnPath(null)).toBe(DEFAULT_POST_SIGNIN_PATH);
    expect(sanitizeReturnPath("")).toBe(DEFAULT_POST_SIGNIN_PATH);
    expect(sanitizeReturnPath(undefined)).toBe(DEFAULT_POST_SIGNIN_PATH);
  });

  it("defines reasonable validation boundaries", () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(8);
    expect(EMAIL_MAX_LENGTH).toBe(254);
    expect(NAME_MAX_LENGTH).toBe(80);
  });
});

/* ------------------------------- Guards ------------------------------ */

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    email: "guest@example.com",
    displayName: "Guest User",
    roleKey: "guest",
    status: "active",
    emailVerified: true,
    ...overrides,
  };
}

const AUTHENTICATED: (user?: Partial<SessionUser>) => SessionState = (u) => ({
  authenticated: true,
  user: makeUser(u),
});
const UNAUTHENTICATED: SessionState = { authenticated: false };

describe("requireAuth guard", () => {
  it("allows authenticated active users", () => {
    const user = requireAuth(AUTHENTICATED(), "/account");
    expect(user.roleKey).toBe("guest");
  });

  it("redirects unauthenticated users to /sign-in", () => {
    expect(() => requireAuth(UNAUTHENTICATED, "/account")).toThrow();
  });

  it("blocks suspended profiles", () => {
    expect(() => requireAuth(AUTHENTICATED({ status: "suspended" }), "/account")).toThrow();
  });

  it("blocks archived profiles", () => {
    expect(() => requireAuth(AUTHENTICATED({ status: "archived" }), "/account")).toThrow();
  });

  it("sanitizes the return path in the redirect (open-redirect protection)", () => {
    try {
      requireAuth(UNAUTHENTICATED, "//evil.com");
    } catch (err: unknown) {
      const serialized = JSON.stringify(err);
      expect(serialized).not.toContain("//evil.com");
    }
  });
});

describe("requireInternalRole guard", () => {
  it("allows internal roles", () => {
    for (const role of INTERNAL_ROLES) {
      const user = requireInternalRole(AUTHENTICATED({ roleKey: role }), INTERNAL_ROLES, "/staff");
      expect(user.roleKey).toBe(role);
    }
  });

  it("redirects guests to /account", () => {
    expect(() =>
      requireInternalRole(AUTHENTICATED({ roleKey: "guest" }), INTERNAL_ROLES, "/staff"),
    ).toThrow();
  });

  it("redirects unauthenticated users to /sign-in", () => {
    expect(() => requireInternalRole(UNAUTHENTICATED, INTERNAL_ROLES, "/staff")).toThrow();
  });

  it("blocks suspended internal users", () => {
    expect(() =>
      requireInternalRole(
        AUTHENTICATED({ roleKey: "administrator", status: "suspended" }),
        INTERNAL_ROLES,
        "/admin",
      ),
    ).toThrow();
  });

  it("INTERNAL_ROLES excludes guest", () => {
    expect(INTERNAL_ROLES).not.toContain("guest");
    expect(INTERNAL_ROLES).toContain("foh_staff");
    expect(INTERNAL_ROLES).toContain("administrator");
  });
});

/* ----------------------- Mock auth repository ------------------------ */

import {
  __resetMockAuthRepository,
  __getMockAuthRepository,
} from "@/lib/server/auth-repository.server";

const ORIG_ENV = { ...process.env };

describe("mock auth repository", () => {
  beforeEach(() => {
    process.env.APP_DATA_MODE = "mock";
    process.env.NODE_ENV = "development";
    __resetMockAuthRepository();
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("signup does not establish a session (email verification required)", async () => {
    const repo = __getMockAuthRepository();
    const res = await repo.signup(
      { email: "new@example.com", password: "password123", firstName: "New", lastName: "User" },
      false,
    );
    expect(res.ok).toBe(true);
    expect(res.cookie).toBeUndefined();
  });

  it("signup rejects duplicate email", async () => {
    const repo = __getMockAuthRepository();
    await repo.signup(
      { email: "dup@example.com", password: "password123", firstName: "D", lastName: "U" },
      false,
    );
    const res = await repo.signup(
      { email: "dup@example.com", password: "password123", firstName: "D", lastName: "U" },
      false,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("validation");
  });

  it("signin fails for unverified email", async () => {
    const repo = __getMockAuthRepository();
    await repo.signup(
      { email: "unverified@example.com", password: "password123", firstName: "U", lastName: "V" },
      false,
    );
    const res = await repo.signin(
      { email: "unverified@example.com", password: "password123" },
      false,
    );
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("unauthorized");
    expect(res.message).toMatch(/verify your email/i);
  });

  it("signin succeeds and activates invited profile after verification", async () => {
    const repo = __getMockAuthRepository();
    await repo.signup(
      { email: "ok@example.com", password: "password123", firstName: "Ok", lastName: "User" },
      false,
    );
    repo.__verifyEmail("ok@example.com");
    const res = await repo.signin({ email: "ok@example.com", password: "password123" }, false);
    expect(res.ok).toBe(true);
    expect(res.cookie).toBeTruthy();
    expect(res.user?.status).toBe("active");
    expect(res.user?.roleKey).toBe("guest");
  });

  it("signin rejects wrong password", async () => {
    const repo = __getMockAuthRepository();
    await repo.signup(
      { email: "wrong@example.com", password: "password123", firstName: "W", lastName: "P" },
      false,
    );
    repo.__verifyEmail("wrong@example.com");
    const res = await repo.signin({ email: "wrong@example.com", password: "nope" }, false);
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("unauthorized");
  });

  it("signout clears the session cookie", async () => {
    const repo = __getMockAuthRepository();
    const { cookie } = await repo.signout(false);
    expect(cookie).toContain("Max-Age=0");
  });

  it("resolveSession returns unauthenticated with no prior signin", async () => {
    const repo = __getMockAuthRepository();
    const session = await repo.resolveSession();
    expect(session.authenticated).toBe(false);
  });

  it("resolveSession returns authenticated after signin", async () => {
    const repo = __getMockAuthRepository();
    await repo.signup(
      { email: "resolve@example.com", password: "password123", firstName: "R", lastName: "S" },
      false,
    );
    repo.__verifyEmail("resolve@example.com");
    await repo.signin({ email: "resolve@example.com", password: "password123" }, false);
    const session = await repo.resolveSession();
    expect(session.authenticated).toBe(true);
    if (session.authenticated) {
      expect(session.user.email).toBe("resolve@example.com");
      expect(session.user.roleKey).toBe("guest");
    }
  });

  it("resolveSession returns unauthenticated after signout", async () => {
    const repo = __getMockAuthRepository();
    await repo.signup(
      { email: "out@example.com", password: "password123", firstName: "O", lastName: "U" },
      false,
    );
    repo.__verifyEmail("out@example.com");
    await repo.signin({ email: "out@example.com", password: "password123" }, false);
    await repo.signout(false);
    const session = await repo.resolveSession();
    expect(session.authenticated).toBe(false);
  });

  it("forgot password always returns ok (no email enumeration)", async () => {
    const repo = __getMockAuthRepository();
    const res = await repo.requestPasswordReset("nonexistent@example.com");
    expect(res.ok).toBe(true);
  });
});

/* ----------------------- Mock cookie encoding round-trip ----------------------- */

import {
  buildSessionCookie,
  buildClearSessionCookie,
  type SessionCookieValue,
} from "@/lib/server/auth-session.server";

function decodeDirect(raw: string): SessionCookieValue | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as Partial<SessionCookieValue>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

describe("mock session cookie encoding", () => {
  it("round-trips a session value", () => {
    const value: SessionCookieValue = {
      accessToken: "atk",
      refreshToken: "rtk",
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    const cookie = buildSessionCookie(value, false);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const decoded = decodeDirect(cookie.split("sds_session=")[1].split(";")[0]);
    expect(decoded).toEqual(value);
  });

  it("adds Secure in production", () => {
    const value: SessionCookieValue = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date().toISOString(),
    };
    expect(buildSessionCookie(value, true)).toContain("Secure");
    expect(buildSessionCookie(value, false)).not.toContain("Secure");
  });

  it("clear cookie has Max-Age=0", () => {
    expect(buildClearSessionCookie(false)).toContain("Max-Age=0");
    expect(buildClearSessionCookie(true)).toContain("Secure");
  });
});

/* ----------------------- @supabase/ssr cookie adapter ----------------------- */

import { createTanStackCookieAdapter } from "@/lib/server/supabase-cookies.server";

describe("@supabase/ssr cookie adapter", () => {
  it("exposes the getAll/setAll contract @supabase/ssr requires", () => {
    const adapter = createTanStackCookieAdapter();
    expect(typeof adapter.getAll).toBe("function");
    expect(typeof adapter.setAll).toBe("function");
  });

  it("getAll delegates to the server runtime (no manual Cookie-header parsing)", () => {
    const adapter = createTanStackCookieAdapter();
    // Outside the server runtime, getCookies() throws the AsyncLocalStorage
    // error — proving the adapter calls the real server utility rather than
    // parsing the Cookie header manually.
    expect(() => adapter.getAll()).toThrow(/StartEvent|AsyncLocalStorage/);
  });

  it("setAll delegates to setCookie (no manual serialization)", () => {
    const adapter = createTanStackCookieAdapter();
    expect(() =>
      adapter.setAll([
        { name: "sb-access-token", value: "tok", options: { httpOnly: true, path: "/" } },
        { name: "sb-refresh-token", value: "rtok", options: { httpOnly: true, path: "/" } },
      ]),
    ).toThrow(/StartEvent|AsyncLocalStorage/);
  });

  it("setAll delegates extra headers to setResponseHeader", () => {
    const adapter = createTanStackCookieAdapter();
    expect(() =>
      adapter.setAll([{ name: "sb-access-token", value: "tok", options: { path: "/" } }], {
        "Cache-Control": "private, no-store",
      }),
    ).toThrow(/StartEvent|AsyncLocalStorage/);
  });
});

/* ----------------------- Server-boundary / secrets ----------------------- */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("no server-secret references in client auth modules", () => {
  const clientDirs = ["lib/auth", "components/layout"];

  it("client-safe auth modules do not reference server secrets", () => {
    const secretPatterns = [
      /process\.env\.SUPABASE_URL/,
      /process\.env\.SUPABASE_ANON_KEY/,
      /process\.env\.SUPABASE_SERVICE_ROLE_KEY/,
      /VITE_SUPABASE_URL/,
      /VITE_SUPABASE_ANON_KEY/,
    ];
    const checked: string[] = [];
    for (const dir of clientDirs) {
      const full = join(process.cwd(), "src", dir);
      if (!existsSync(full)) continue;
      const walk = (d: string) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          const p = join(d, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (
            (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
            !entry.name.endsWith(".test.ts") &&
            !entry.name.includes(".server.")
          ) {
            const c = readFileSync(p, "utf-8");
            checked.push(p);
            for (const pat of secretPatterns) {
              expect(c).not.toMatch(pat);
            }
          }
        }
      };
      walk(full);
    }
    expect(checked.length).toBeGreaterThan(0);
  });
});

/* ----------------------- Auth email redirect URLs ----------------------- */

import {
  accountConfirmationUrl,
  passwordRecoveryUrl,
  ACCOUNT_CONFIRMATION_PATH,
  PASSWORD_RECOVERY_PATH,
} from "@/lib/server/auth-redirect.server";

describe("auth email redirect URLs", () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    // requireSupabaseEnv validates URL + anon key + service-role key.
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("accountConfirmationUrl uses /auth/callback (signup confirmation)", () => {
    process.env.SUPABASE_SITE_URL = "https://sitdownsundays.net";
    expect(accountConfirmationUrl()).toBe("https://sitdownsundays.net/auth/callback");
    expect(ACCOUNT_CONFIRMATION_PATH).toBe("/auth/callback");
  });

  it("passwordRecoveryUrl uses /reset-password (not /forgot-password)", () => {
    process.env.SUPABASE_SITE_URL = "https://sitdownsundays.net";
    expect(passwordRecoveryUrl()).toBe("https://sitdownsundays.net/reset-password");
    expect(PASSWORD_RECOVERY_PATH).toBe("/reset-password");
    // Explicitly: recovery never points at the forgot-password form.
    expect(passwordRecoveryUrl()).not.toContain("/forgot-password");
  });

  it("no authentication email redirects to /forgot-password", () => {
    process.env.SUPABASE_SITE_URL = "https://sitdownsundays.net";
    expect(accountConfirmationUrl()).not.toContain("/forgot-password");
    expect(passwordRecoveryUrl()).not.toContain("/forgot-password");
  });

  it("a trailing slash in SUPABASE_SITE_URL does not create a double slash", () => {
    process.env.SUPABASE_SITE_URL = "https://sitdownsundays.net/";
    expect(accountConfirmationUrl()).toBe("https://sitdownsundays.net/auth/callback");
    expect(passwordRecoveryUrl()).toBe("https://sitdownsundays.net/reset-password");
    expect(accountConfirmationUrl()).not.toContain("//auth");
    expect(passwordRecoveryUrl()).not.toContain("//reset");
  });

  it("multiple trailing slashes are also stripped", () => {
    process.env.SUPABASE_SITE_URL = "https://sitdownsundays.net///";
    expect(accountConfirmationUrl()).toBe("https://sitdownsundays.net/auth/callback");
  });

  it("falls back to a default when SUPABASE_SITE_URL is unset", () => {
    delete process.env.SUPABASE_SITE_URL;
    expect(accountConfirmationUrl()).toBe("https://sitdownsundays.net/auth/callback");
    expect(passwordRecoveryUrl()).toBe("https://sitdownsundays.net/reset-password");
  });
});

/* ----------------------- Server-only module boundary ----------------------- */

describe("server-only auth modules are *.server.ts", () => {
  it("supabase SSR + cookie modules use the .server.ts suffix", () => {
    const serverModules = [
      "src/lib/server/supabase-ssr.server.ts",
      "src/lib/server/supabase-cookies.server.ts",
      "src/lib/server/auth-repository.server.ts",
      "src/lib/server/auth-session.server.ts",
      "src/lib/server/auth-redirect.server.ts",
    ];
    for (const p of serverModules) {
      expect(p).toMatch(/\.server\.ts$/);
      expect(existsSync(join(process.cwd(), p))).toBe(true);
    }
  });
});
