/**
 * Client-safe authentication types.
 *
 * No secrets, no tokens, no server-only imports. These shapes are what server
 * functions return to the browser. Refresh tokens and access tokens are NEVER
 * included here — only a minimal, non-sensitive session user.
 */
import type { RoleKey } from "@/lib/domain/types";

/** A minimal, non-sensitive representation of the signed-in user. */
export interface SessionUser {
  id: string;
  email: string;
  /** Display name derived from the profile (first + last). May be empty. */
  displayName: string;
  /** Highest-priority role key. Always "guest" for public signups. */
  roleKey: RoleKey;
  /** Profile status. "active" users may establish a session. */
  status: "invited" | "active" | "suspended" | "archived";
  /** Whether the user's email has been verified. */
  emailVerified: boolean;
}

/** The absence of a session. */
export interface NoSession {
  authenticated: false;
}

/** The presence of a session. */
export interface ActiveSession {
  authenticated: true;
  user: SessionUser;
}

/** Result of session retrieval — never carries tokens. */
export type SessionState = NoSession | ActiveSession;

/** Generic auth operation result. */
export type AuthResult =
  | { ok: true }
  | { ok: false; kind: "validation"; errors: Record<string, string> }
  | { ok: false; kind: "unauthorized"; message: string }
  | { ok: false; kind: "unexpected"; message: string };

/** Result for operations that redirect on success (e.g. callback). */
export type AuthRedirectResult =
  | { ok: true; redirectTo: string }
  | { ok: false; kind: "validation" | "unexpected"; message: string };

/** Result for session retrieval exposed to the browser. */
export type SessionResult =
  { ok: true; session: SessionState } | { ok: false; kind: "unexpected"; message: string };
