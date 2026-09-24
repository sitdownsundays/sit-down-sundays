/**
 * Authentication server functions — thin client-safe wrappers.
 *
 * Components import these (NOT the *.server.ts helpers). The build replaces
 * their implementations with RPC stubs in client bundles, so server-only
 * modules, secrets, and tokens never enter the client dependency graph.
 *
 * SESSION ARCHITECTURE:
 *  - Supabase mode: the @supabase/ssr server client stages auth + PKCE
 *    cookies onto the response through the TanStack Start cookie adapter.
 *    Those headers are committed automatically by setResponseHeader. No
 *    custom session cookie is returned.
 *  - Mock mode: the repository returns a dev-only Set-Cookie header which
 *    we write via setResponseHeader.
 *
 * Each handler:
 *  - Validates input strictly (rejects unknown/protected fields).
 *  - Ignores any role submitted by the browser.
 *  - Establishes/clears the session via the repository + cookie adapter.
 *  - Returns a non-sensitive result (never refresh tokens or secrets).
 *  - Sanitizes return paths to reject open redirects.
 */
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAuthRepository } from "@/lib/server/auth-repository.server";
import { resolveDataMode } from "@/lib/server/env.server";
import {
  sanitizeReturnPath,
  DEFAULT_POST_SIGNIN_PATH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
} from "@/lib/auth/constants";
import type {
  AuthResult,
  AuthRedirectResult,
  SessionResult,
  SessionState,
  SessionUser,
} from "@/lib/auth/types";

/* ------------------------------- Sign up -------------------------------- */

const signupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(EMAIL_MAX_LENGTH),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    firstName: z.string().trim().min(1).max(NAME_MAX_LENGTH),
    lastName: z.string().trim().min(1).max(NAME_MAX_LENGTH),
    returnTo: z.string().optional(),
  })
  .strict();

export const signUp = createServerFn({ method: "POST" })
  .validator((raw: unknown) => signupSchema.parse(raw))
  .handler(async ({ data }): Promise<AuthResult & { redirectTo?: string }> => {
    try {
      const { isProduction } = resolveDataMode();
      const repo = getAuthRepository();
      const result = await repo.signup(
        {
          email: data.email,
          password: data.password,
          firstName: data.firstName,
          lastName: data.lastName,
        },
        isProduction,
      );
      if (result.ok) {
        // Mock mode returns a dev-only cookie; Supabase mode stages via adapter.
        if (result.cookie) setResponseHeader("set-cookie", result.cookie);
        return { ok: true, redirectTo: sanitizeReturnPath(data.returnTo) };
      }
      return {
        ok: false,
        kind: result.kind ?? "unexpected",
        message: result.message ?? "Sign-up could not be completed.",
      };
    } catch {
      return { ok: false, kind: "unexpected", message: "Sign-up could not be completed." };
    }
  });

/* ------------------------------- Sign in -------------------------------- */

const signinSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(EMAIL_MAX_LENGTH),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    returnTo: z.string().optional(),
  })
  .strict();

export const signIn = createServerFn({ method: "POST" })
  .validator((raw: unknown) => signinSchema.parse(raw))
  .handler(async ({ data }): Promise<AuthResult & { redirectTo?: string }> => {
    try {
      const { isProduction } = resolveDataMode();
      const repo = getAuthRepository();
      const result = await repo.signin(
        { email: data.email, password: data.password },
        isProduction,
      );
      if (result.ok) {
        if (result.cookie) setResponseHeader("set-cookie", result.cookie);
        return { ok: true, redirectTo: sanitizeReturnPath(data.returnTo) };
      }
      return {
        ok: false,
        kind: result.kind ?? "unexpected",
        message: result.message ?? "Sign-in could not be completed.",
      };
    } catch {
      return { ok: false, kind: "unexpected", message: "Sign-in could not be completed." };
    }
  });

/* ------------------------------- Sign out -------------------------------- */

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { isProduction } = resolveDataMode();
    const repo = getAuthRepository();
    const result = await repo.signout(isProduction);
    // Mock mode returns a clear cookie; Supabase mode stages clears via adapter.
    if ("cookie" in result && result.cookie) setResponseHeader("set-cookie", result.cookie);
    return { ok: true, redirectTo: "/" } as const;
  } catch {
    return { ok: false, kind: "unexpected" } as const;
  }
});

/* --------------------------- Email verification -------------------------- */

const callbackSchema = z
  .object({
    authCode: z.string().min(1),
    codeVerifier: z.string().optional(),
  })
  .strict();

export const handleAuthCallback = createServerFn({ method: "POST" })
  .validator((raw: unknown) => callbackSchema.parse(raw))
  .handler(async ({ data }): Promise<AuthRedirectResult> => {
    try {
      const { isProduction } = resolveDataMode();
      const repo = getAuthRepository();
      const result = await repo.exchangeCallback(
        { authCode: data.authCode, codeVerifier: data.codeVerifier },
        isProduction,
      );
      if (result.ok) {
        if (result.cookie) setResponseHeader("set-cookie", result.cookie);
        return { ok: true, redirectTo: sanitizeReturnPath(result.redirectTo) };
      }
      return {
        ok: false,
        kind: result.kind === "validation" ? "validation" : "unexpected",
        message: result.message ?? "Verification could not be completed.",
      };
    } catch {
      return { ok: false, kind: "unexpected", message: "Verification could not be completed." };
    }
  });

/* --------------------------- Forgot password ----------------------------- */

const forgotSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(EMAIL_MAX_LENGTH) })
  .strict();

/**
 * Forgot-password handler. Always returns ok to avoid revealing which emails
 * exist in the system.
 */
export const forgotPassword = createServerFn({ method: "POST" })
  .validator((raw: unknown) => forgotSchema.parse(raw))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const repo = getAuthRepository();
      await repo.requestPasswordReset(data.email);
    } catch {
      /* neutral */
    }
    return { ok: true };
  });

/* ---------------------------- Reset password ----------------------------- */

const resetSchema = z
  .object({
    newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    accessToken: z.string().optional(),
    code: z.string().optional(),
  })
  .strict();

export const resetPassword = createServerFn({ method: "POST" })
  .validator((raw: unknown) => resetSchema.parse(raw))
  .handler(async ({ data }): Promise<AuthResult> => {
    try {
      const { isProduction } = resolveDataMode();
      const repo = getAuthRepository();
      const result = await repo.resetPassword(
        {
          newPassword: data.newPassword,
          accessToken: data.accessToken,
          code: data.code,
        },
        isProduction,
      );
      if (result.ok) {
        if (result.cookie) setResponseHeader("set-cookie", result.cookie);
        return { ok: true };
      }
      return {
        ok: false,
        kind: result.kind ?? "unexpected",
        message: result.message ?? "Password reset could not be completed.",
      };
    } catch {
      return { ok: false, kind: "unexpected", message: "Password reset could not be completed." };
    }
  });

/* --------------------------- Current session ----------------------------- */

export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionResult> => {
    try {
      const repo = getAuthRepository();
      const session: SessionState = await repo.resolveSession();
      return { ok: true, session };
    } catch {
      return { ok: false, kind: "unexpected", message: "Session could not be retrieved." };
    }
  },
);

/* --------------------- Public auth config (client-safe) ------------------- */

export const getAuthPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { dataMode } = resolveDataMode();
    return { dataMode, postSigninPath: DEFAULT_POST_SIGNIN_PATH } as const;
  } catch {
    return { dataMode: "supabase", postSigninPath: DEFAULT_POST_SIGNIN_PATH } as const;
  }
});

export type { SessionUser };
