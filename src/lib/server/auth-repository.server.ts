/**
 * SERVER-ONLY — authentication repository.
 *
 * Two implementations behind one interface:
 *  - MockAuthRepository: in-memory, local development only (APP_DATA_MODE=mock).
 *  - SupabaseAuthRepository: server-side Supabase Auth via @supabase/ssr.
 *
 * SESSION ARCHITECTURE (Supabase mode):
 *  - The @supabase/ssr server client manages its own HttpOnly session + PKCE
 *    cookies through the TanStack Start cookie adapter (supabase-cookies.server).
 *  - There is NO custom base64url `sds_session` cookie anymore.
 *  - Auth flows (signup, signin, callback, reset) call the SSR client, which
 *    stages Set-Cookie headers onto the response automatically. The server
 *    function layer commits those headers.
 *  - Session resolution verifies identity with `auth.getUser()` server-side —
 *    never by trusting decoded cookie contents or `getSession()` alone.
 *
 * SECURITY:
 *  - Uses the anon-key SSR client for user-facing auth flows so RLS applies.
 *    The service-role client is used ONLY for profile status reads/updates
 *    and role lookups (administrative, never exposed to the browser).
 *  - Never returns refresh tokens or access tokens to the caller.
 *  - Public signup receives ONLY the Guest role (enforced by the DB trigger).
 *    Any role submitted by the browser is ignored.
 *  - On a verified session, an `invited` profile is moved to `active`.
 *  - `suspended` and `archived` profiles are blocked from establishing a
 *    session.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase-admin.server";
import { getSupabaseSSRClient } from "./supabase-ssr.server";
import { resolveDataMode } from "./env.server";
import { accountConfirmationUrl, passwordRecoveryUrl } from "./auth-redirect.server";
import {
  buildSessionCookie,
  buildClearSessionCookie,
  readSessionCookie,
  type SessionCookieValue,
} from "./auth-session.server";
import type { RoleKey } from "@/lib/domain/types";
import type { SessionUser, SessionState } from "@/lib/auth/types";

export interface AuthSignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface AuthSigninInput {
  email: string;
  password: string;
}

export interface AuthCallbackInput {
  /** The authorization code from the email/verification redirect. */
  authCode: string;
  /** The PKCE code_verifier (read from the SSR-managed cookie when present). */
  codeVerifier?: string;
}

export interface AuthResetInput {
  newPassword: string;
  /** The access_token from the recovery redirect (legacy/implicit flow). */
  accessToken?: string;
  /** The PKCE code from the recovery redirect (preferred flow). */
  code?: string;
}

/**
 * Result of an operation that establishes or refreshes a session.
 *
 * In Supabase mode, `cookiesCommitted` is true when the SSR client staged
 * Set-Cookie headers onto the response (the server function layer commits
 * them). In mock mode, `cookie` carries the dev-only session cookie.
 */
export interface SessionEstablishResult {
  ok: boolean;
  /** Mock-mode Set-Cookie header to write when ok. */
  cookie?: string;
  /** Supabase-mode: the SSR client staged auth cookies onto the response. */
  cookiesCommitted?: boolean;
  /** The non-sensitive session user, when ok. */
  user?: SessionUser;
  /** Error kind/message when not ok. */
  kind?: "validation" | "unauthorized" | "unexpected";
  message?: string;
}

export interface AuthRepository {
  signup(input: AuthSignupInput, isProduction: boolean): Promise<SessionEstablishResult>;
  signin(input: AuthSigninInput, isProduction: boolean): Promise<SessionEstablishResult>;
  signout(isProduction: boolean): Promise<{ cookie?: string; cookiesCommitted?: boolean }>;
  exchangeCallback(
    input: AuthCallbackInput,
    isProduction: boolean,
  ): Promise<SessionEstablishResult & { redirectTo?: string }>;
  requestPasswordReset(email: string): Promise<{ ok: boolean }>;
  resetPassword(input: AuthResetInput, isProduction: boolean): Promise<SessionEstablishResult>;
  /** Resolve the current session server-side via getUser(). */
  resolveSession(): Promise<SessionState>;
}

/* ----------------------------- Shared helpers ----------------------------- */

interface ProfileRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: "invited" | "active" | "suspended" | "archived";
}

function toSessionUser(
  userId: string,
  email: string,
  emailVerified: boolean,
  profile: ProfileRow | null,
  roleKey: RoleKey,
): SessionUser {
  return {
    id: userId,
    email,
    displayName: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim(),
    roleKey,
    status: profile?.status ?? "invited",
    emailVerified,
  };
}

/* ----------------------------- Mock repository ----------------------------- */

interface MockAccount {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  status: "invited" | "active" | "suspended" | "archived";
  roleKey: RoleKey;
  sessionToken: string | null;
}

class MockAuthRepository implements AuthRepository {
  private accounts: MockAccount[] = [];
  /**
   * Test/dev-only: the session token of the most recent successful signin in
   * this process. In production mock mode the request cookie is the source of
   * truth; this field lets resolveSession work in unit tests (no request
   * context) and across a single dev session.
   */
  private currentSessionToken: string | null = null;

  private find(email: string): MockAccount | undefined {
    return this.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
  }

  async signup(input: AuthSignupInput, _isProduction: boolean): Promise<SessionEstablishResult> {
    if (this.find(input.email)) {
      return {
        ok: false,
        kind: "validation",
        message: "An account with that email already exists.",
      };
    }
    const account: MockAccount = {
      id: crypto.randomUUID(),
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      emailVerified: false,
      status: "invited",
      roleKey: "guest",
      sessionToken: null,
    };
    this.accounts.push(account);
    // Mock mode: no real email is sent. Return ok without a session.
    return { ok: true };
  }

  async signin(input: AuthSigninInput, isProduction: boolean): Promise<SessionEstablishResult> {
    const account = this.find(input.email);
    if (!account || account.password !== input.password) {
      return { ok: false, kind: "unauthorized", message: "Invalid email or password." };
    }
    if (account.status === "suspended" || account.status === "archived") {
      return {
        ok: false,
        kind: "unauthorized",
        message: "This account is not available. Please contact us.",
      };
    }
    if (!account.emailVerified) {
      return {
        ok: false,
        kind: "unauthorized",
        message: "Please verify your email before signing in.",
      };
    }
    if (account.status === "invited") account.status = "active";
    const token = crypto.randomUUID();
    account.sessionToken = token;
    this.currentSessionToken = token;
    const cookie = this.buildCookie(token, isProduction);
    return {
      ok: true,
      cookie,
      user: toSessionUser(account.id, account.email, true, this.mockProfile(account), "guest"),
    };
  }

  async signout(isProduction: boolean): Promise<{ cookie: string }> {
    this.currentSessionToken = null;
    return { cookie: buildClearSessionCookie(isProduction) };
  }

  async exchangeCallback(
    _input: AuthCallbackInput,
    _isProduction: boolean,
  ): Promise<SessionEstablishResult & { redirectTo?: string }> {
    return {
      ok: false,
      kind: "unexpected",
      message: "Email verification is not available in mock mode.",
    };
  }

  async requestPasswordReset(_email: string): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async resetPassword(
    _input: AuthResetInput,
    _isProduction: boolean,
  ): Promise<SessionEstablishResult> {
    return {
      ok: false,
      kind: "unexpected",
      message: "Password reset is not available in mock mode.",
    };
  }

  async resolveSession(): Promise<SessionState> {
    // Prefer the in-process session token (set by signin); fall back to the
    // dev-only request cookie when present.
    let token = this.currentSessionToken;
    if (!token) {
      try {
        const cookie = readSessionCookie();
        token = cookie?.accessToken ?? null;
      } catch {
        token = null;
      }
    }
    if (!token) return { authenticated: false };
    const account = this.accounts.find((a) => a.sessionToken === token);
    if (!account) return { authenticated: false };
    if (account.status === "suspended" || account.status === "archived") {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      user: toSessionUser(
        account.id,
        account.email,
        account.emailVerified,
        this.mockProfile(account),
        "guest",
      ),
    };
  }

  /** Test helper: mark a mock account as email-verified. */
  __verifyEmail(email: string): boolean {
    const account = this.find(email);
    if (account) account.emailVerified = true;
    return !!account;
  }

  private mockProfile(account: MockAccount): ProfileRow {
    return {
      id: account.id,
      email: account.email,
      first_name: account.firstName,
      last_name: account.lastName,
      status: account.status,
    };
  }

  private buildCookie(token: string, isProduction: boolean): string {
    const value: SessionCookieValue = {
      accessToken: token,
      refreshToken: "mock",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    return buildSessionCookie(value, isProduction);
  }
}

/* --------------------------- Supabase repository --------------------------- */

class BlockedProfileError extends Error {
  constructor(public status: string) {
    super("blocked");
  }
}

class SupabaseAuthRepository implements AuthRepository {
  async signup(input: AuthSignupInput, _isProduction: boolean): Promise<SessionEstablishResult> {
    const client = getSupabaseSSRClient();
    // Browser-supplied role is NEVER trusted. The DB trigger assigns Guest only.
    // New-account email confirmation redirects to /auth/callback (PKCE).
    const { data, error } = await client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { first_name: input.firstName, last_name: input.lastName },
        emailRedirectTo: accountConfirmationUrl(),
      },
    });

    if (error) return this.mapAuthError(error);

    // If email confirmation is required, no session is returned. The PKCE
    // verifier cookie has already been staged by the SSR client.
    if (!data.session) return { ok: true, cookiesCommitted: true };

    // Some Supabase configs auto-confirm and return a session immediately.
    return await this.establishFromSession(client, data.session);
  }

  async signin(input: AuthSigninInput, _isProduction: boolean): Promise<SessionEstablishResult> {
    const client = getSupabaseSSRClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) return this.mapAuthError(error);
    if (!data.session) {
      return { ok: false, kind: "unexpected", message: "Sign-in could not complete." };
    }
    return await this.establishFromSession(client, data.session);
  }

  async signout(_isProduction: boolean): Promise<{ cookiesCommitted: boolean }> {
    // @supabase/ssr's signOut() stages the cookie clears through the adapter
    // (setCookie with Max-Age=0). No manual cookie manipulation is needed.
    try {
      const client = getSupabaseSSRClient();
      await client.auth.signOut();
    } catch {
      /* cookie clear is authoritative via the adapter */
    }
    return { cookiesCommitted: true };
  }

  async exchangeCallback(
    input: AuthCallbackInput,
    _isProduction: boolean,
  ): Promise<SessionEstablishResult & { redirectTo?: string }> {
    const client = getSupabaseSSRClient();
    // The PKCE code_verifier is stored in a cookie by @supabase/ssr during
    // signup/recovery. exchangeCodeForSession reads it automatically when the
    // SSR client's cookie store is populated. We pass an explicit verifier
    // only as a fallback.
    const { data, error } = await client.auth.exchangeCodeForSession({
      authCode: input.authCode,
      codeVerifier: input.codeVerifier,
    });

    if (error || !data.session) {
      return { ok: false, kind: "unexpected", message: "Verification could not be completed." };
    }
    const result = await this.establishFromSession(client, data.session);
    return { ...result, redirectTo: "/account" };
  }

  async requestPasswordReset(email: string): Promise<{ ok: boolean }> {
    const client = getSupabaseSSRClient();
    // Password-recovery email link redirects to /reset-password (PKCE), never
    // to /forgot-password (which only displays the request form).
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: passwordRecoveryUrl(),
    });
    // Always return ok to avoid revealing which emails exist.
    void error;
    return { ok: true };
  }

  async resetPassword(
    input: AuthResetInput,
    _isProduction: boolean,
  ): Promise<SessionEstablishResult> {
    const client = getSupabaseSSRClient();
    // PKCE recovery flow: exchange the code to establish a session first.
    // The SSR client reads the PKCE verifier from its cookie automatically.
    if (input.code) {
      const { error: codeErr } = await client.auth.exchangeCodeForSession({
        authCode: input.code,
      });
      if (codeErr) {
        return { ok: false, kind: "validation", message: "Reset link is invalid or expired." };
      }
    } else if (input.accessToken) {
      // Legacy implicit flow: set the session from the access token.
      const { error: sessionErr } = await client.auth.setSession({
        access_token: input.accessToken,
        refresh_token: "",
      });
      if (sessionErr) {
        return { ok: false, kind: "validation", message: "Reset link is invalid or expired." };
      }
    }
    const { error } = await client.auth.updateUser({ password: input.newPassword });
    if (error) {
      return { ok: false, kind: "validation", message: "Reset link is invalid or expired." };
    }
    return { ok: true, cookiesCommitted: true };
  }

  /**
   * Resolve the current session server-side. Identity is verified with
   * `auth.getUser()` — NOT by trusting decoded cookie contents or
   * `getSession()` alone (getSession reads the cookie without validating
   * against the server).
   */
  async resolveSession(): Promise<SessionState> {
    const client = getSupabaseSSRClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return { authenticated: false };

    try {
      const user = await this.buildSessionUser(data.user);
      return { authenticated: true, user };
    } catch (err) {
      if (err instanceof BlockedProfileError) return { authenticated: false };
      return { authenticated: false };
    }
  }

  /** Establish a session from a freshly-issued Supabase session. */
  private async establishFromSession(
    _client: SupabaseClient,
    session: {
      access_token: string;
      refresh_token: string;
      expires_at?: number;
      user?: { id: string; email?: string; email_confirmed_at?: string | null };
    },
  ): Promise<SessionEstablishResult> {
    try {
      const user = await this.buildSessionUser(
        session.user ?? { id: "", email: "", email_confirmed_at: null },
      );
      // The SSR client has already staged the session cookies onto the
      // response via the cookie adapter.
      return { ok: true, cookiesCommitted: true, user };
    } catch (err) {
      if (err instanceof BlockedProfileError) {
        return {
          ok: false,
          kind: "unauthorized",
          message: "This account is not available. Please contact us.",
        };
      }
      return { ok: false, kind: "unexpected", message: "Sign-in could not complete." };
    }
  }

  private async buildSessionUser(authUser: {
    id: string;
    email?: string;
    email_confirmed_at?: string | null;
  }): Promise<SessionUser> {
    const profile = await this.fetchProfile(authUser.id);
    if (profile && (profile.status === "suspended" || profile.status === "archived")) {
      throw new BlockedProfileError(profile.status);
    }
    if (profile && profile.status === "invited" && authUser.email_confirmed_at) {
      await this.activateProfile(profile.id);
    }
    const roleKey = await this.fetchPrimaryRole(authUser.id);
    return toSessionUser(
      authUser.id,
      authUser.email ?? "",
      !!authUser.email_confirmed_at,
      profile,
      roleKey,
    );
  }

  private async fetchProfile(userId: string): Promise<ProfileRow | null> {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, first_name, last_name, status")
      .eq("id", userId)
      .maybeSingle();
    if (error) return null;
    return (data as ProfileRow | null) ?? null;
  }

  private async activateProfile(userId: string): Promise<void> {
    const admin = getAdminClient();
    await admin.from("profiles").update({ status: "active" }).eq("id", userId);
  }

  private async fetchPrimaryRole(userId: string): Promise<RoleKey> {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("user_roles")
      .select("role_id, roles!inner(key)")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .limit(1);
    if (error || !data || data.length === 0) return "guest";
    const row = data[0] as unknown as { roles?: { key?: string } } | null;
    const key = row?.roles?.key;
    return (key as RoleKey) ?? "guest";
  }

  private mapAuthError(error: { message?: string; status?: number }): SessionEstablishResult {
    const msg = error.message ?? "";
    if (/invalid login credentials|invalid email or password/i.test(msg)) {
      return { ok: false, kind: "unauthorized", message: "Invalid email or password." };
    }
    if (/already registered|already exists/i.test(msg)) {
      return {
        ok: false,
        kind: "validation",
        message: "An account with that email already exists.",
      };
    }
    if (/rate limit|too many/i.test(msg)) {
      return {
        ok: false,
        kind: "unexpected",
        message: "Too many attempts. Please try again shortly.",
      };
    }
    return { ok: false, kind: "unexpected", message: "Authentication could not be completed." };
  }
}

/* ------------------------------ Dispatch --------------------------------- */

let mockInstance: MockAuthRepository | null = null;

/** Test-only: reset mock auth state. No effect in Supabase mode. */
export function __resetMockAuthRepository(): void {
  mockInstance = null;
}

/** Test-only: access the mock auth repository (throws in Supabase mode). */
export function __getMockAuthRepository(): MockAuthRepository {
  const { dataMode } = resolveDataMode();
  if (dataMode !== "mock") throw new Error("Not in mock mode.");
  if (!mockInstance) mockInstance = new MockAuthRepository();
  return mockInstance;
}

/** Return the active auth repository based on APP_DATA_MODE. */
export function getAuthRepository(): AuthRepository {
  const { dataMode } = resolveDataMode();
  if (dataMode === "mock") {
    if (!mockInstance) mockInstance = new MockAuthRepository();
    return mockInstance;
  }
  return new SupabaseAuthRepository();
}
