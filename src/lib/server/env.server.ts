/**
 * SERVER-ONLY — environment validation & narrow accessors.
 *
 * This module is blocked from the client bundle by filename (*.server.ts).
 * It reads process.env INSIDE functions (env injection happens at call time
 * on the Worker runtime), never at module scope.
 *
 * Never logs or returns secret values. Provides narrow accessors rather than
 * exporting the full environment object.
 */

export type DataMode = "mock" | "supabase";

export interface ResolvedEnv {
  dataMode: DataMode;
  isProduction: boolean;
}

export interface SupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  siteUrl?: string;
}

const VALID_MODES = new Set<DataMode>(["mock", "supabase"]);

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Resolve the data mode + production flag. Throws a safe, secret-free error
 * when configuration is invalid for the current environment.
 *
 * Rules:
 *  - APP_DATA_MODE must be "mock" or "supabase".
 *  - Production (NODE_ENV=production) may never use "mock".
 *  - "supabase" mode requires valid Supabase configuration (checked lazily
 *    by requireSupabaseEnv when an operation actually needs it).
 */
export function resolveDataMode(): ResolvedEnv {
  const mode = process.env.APP_DATA_MODE;
  const isProduction = process.env.NODE_ENV === "production";

  if (!mode || !VALID_MODES.has(mode as DataMode)) {
    throw new Error(
      "Application data mode is not configured. Set APP_DATA_MODE to 'mock' or 'supabase'.",
    );
  }

  if (mode === "mock" && isProduction) {
    throw new Error("Mock data mode is not permitted in production.");
  }

  return { dataMode: mode as DataMode, isProduction };
}

/**
 * Require valid Supabase configuration. Called lazily by operations that
 * genuinely need a Supabase client. Throws a safe error if missing/invalid.
 * Never returns the service-role key to callers beyond this module.
 */
export function requireSupabaseEnv(): SupabaseEnv {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const siteUrl = process.env.SUPABASE_SITE_URL;

  if (!url || !isHttpsUrl(url)) {
    throw new Error("Supabase URL is missing or not a valid HTTPS URL.");
  }
  if (!anonKey) {
    throw new Error("Supabase anon key is not configured.");
  }
  if (!serviceRoleKey) {
    throw new Error("Supabase service-role key is not configured.");
  }

  return { url, anonKey, serviceRoleKey, siteUrl };
}

/** Whether Supabase mode is active (does not validate config). */
export function isSupabaseMode(): boolean {
  try {
    return resolveDataMode().dataMode === "supabase";
  } catch {
    return false;
  }
}

/** Whether mock mode is active (local development only). */
export function isMockMode(): boolean {
  try {
    return resolveDataMode().dataMode === "mock";
  } catch {
    return false;
  }
}

/**
 * Public config safe to return to the browser. Carries only the data-mode
 * label — never secrets or URLs.
 */
export function getPublicDataMode(): "mock" | "supabase" {
  return resolveDataMode().dataMode;
}
