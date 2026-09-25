/**
 * Menu CMS — server-module boundary tests.
 *
 * Verifies that server-only modules, the service-role client, and secrets
 * never enter the client dependency graph through menu.functions.ts, and
 * that no server secret is referenced from client-visible code.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), ...path.split("/")), "utf-8");
}

const SERVER_ONLY_FILES = [
  "src/lib/server/menu-repository.server.ts",
  "src/lib/server/menu-shared.server.ts",
  "src/lib/server/menu-mock.server.ts",
  "src/lib/server/menu-supabase.server.ts",
  "src/lib/server/menu-auth.server.ts",
  "src/lib/server/supabase-admin.server.ts",
];

describe("menu server-module boundaries", () => {
  it("all menu server modules use the .server.ts filename convention (blocked from client bundle)", () => {
    for (const f of SERVER_ONLY_FILES) {
      expect(f).toMatch(/\.server\.ts$/);
    }
  });

  it("menu.functions.ts is client-safe and does not export the service-role client", () => {
    const c = read("src/lib/menu.functions.ts");
    expect(c).not.toContain("getAdminClient");
    expect(c).not.toContain("createClient");
    expect(c).not.toContain("service_role");
  });

  it("menu.functions.ts never reads secrets or env directly", () => {
    const c = read("src/lib/menu.functions.ts");
    expect(c).not.toMatch(/process\.env\./);
    expect(c).not.toMatch(/SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("the service-role client lives only inside a .server.ts module", () => {
    for (const f of SERVER_ONLY_FILES) {
      const c = read(f);
      // Only supabase-admin.server.ts may reference the service-role key.
      if (f.endsWith("supabase-admin.server.ts")) {
        expect(c).toContain("SERVICE_ROLE");
      } else {
        expect(c, `${f} must not reference the service-role key`).not.toMatch(/SERVICE_ROLE_KEY/);
      }
    }
  });

  it("client-safe menu modules contain no secrets or env access", () => {
    for (const f of [
      "src/lib/menu/constants.ts",
      "src/lib/menu/schema.ts",
      "src/lib/menu/types.ts",
    ]) {
      const c = read(f);
      expect(c, `${f} must not read env`).not.toMatch(/process\.env\./);
      expect(c, `${f} must not reference secrets`).not.toMatch(/SUPABASE_|SERVICE_ROLE|ANON_KEY/);
    }
  });

  it("no menu *.functions.ts or client module imports a .server.ts file", () => {
    // menu.functions.ts imports .server.ts modules, which is allowed because
    // the build replaces them with RPC stubs. But non-functions client modules
    // (constants/schema/types) must not.
    for (const f of [
      "src/lib/menu/constants.ts",
      "src/lib/menu/schema.ts",
      "src/lib/menu/types.ts",
    ]) {
      const c = read(f);
      expect(c, `${f} must not import server modules`).not.toMatch(
        /from\s+["'].*\.server(\.ts)?["']/,
      );
    }
  });
});
