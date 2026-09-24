/**
 * SERVER BOUNDARY CONVENTIONS (Phase 1 — no external services connected)
 * -----------------------------------------------------------------------------
 * This file documents the architectural conventions for future server modules.
 * It defines TYPE-ONLY interfaces and labeled placeholders. It does NOT
 * implement fake services, does NOT connect Supabase, and holds no secrets.
 *
 * Future phases will implement these behind createServerFn handlers in
 * src/lib/*.functions.ts (client-safe wrappers) and src/lib/*.server.ts
 * (server-only helpers blocked from the client bundle).
 *
 * Client components must never import server-only secrets or elevated
 * service clients. They call typed server functions instead.
 */

/**
 * Environment validation contract. Future server modules read
 * process.env.* INSIDE .handler() bodies, never at module scope.
 */
export interface ServerEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_DATA_MODE: "mock" | "production";
  SUPABASE_SITE_URL?: string;
}

/** Placeholder — reads env inside a server boundary in a future phase. */
export interface EnvProvider {
  /** Must be called inside a server function handler only. */
  requireEnv(): ServerEnv;
}

/**
 * Authorization contract. Every elevated server operation must perform
 * authorization before using the administrative client. UI permission gates
 * are presentation only; this is the real enforcement point (future phase).
 */
export interface Authorizer {
  requirePermission(permission: string): Promise<void>;
  requireRole(role: string): Promise<void>;
}

/**
 * Repository contract shape. Future server-only modules implement these
 * against Supabase. Phase 1 does not implement them.
 */
export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  list(): Promise<T[]>;
}

/** Labeled placeholder — not a fake implementation. */
export const SERVER_BOUNDARY_PLACEHOLDER =
  "Phase 1: server modules are type-only conventions. No services connected.";
