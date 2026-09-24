import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROUTES_DIR = join(process.cwd(), "src", "routes");

function listRouteFiles(dir: string, base = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...listRouteFiles(join(dir, entry.name), join(base, entry.name)));
    } else if (entry.name.endsWith(".tsx") && !entry.name.startsWith("__root")) {
      out.push(join(base, entry.name));
    }
  }
  return out;
}

describe("representative route availability", () => {
  const files = listRouteFiles(ROUTES_DIR);

  it("creates all public routes", () => {
    const expected = [
      "_public.tsx",
      "_public.index.tsx",
      "_public.our-story.tsx",
      "_public.the-experience.tsx",
      "_public.menu.tsx",
      "_public.how-it-works.tsx",
      "_public.private-room.tsx",
      "_public.faq.tsx",
      "_public.policies.tsx",
      "_public.waitlist.tsx",
      "_public.book.tsx",
      "_public.contact.tsx",
      "_public.sign-in.tsx",
      "_public.create-account.tsx",
    ];
    for (const f of expected) {
      expect(files).toContain(f);
    }
  });

  it("creates guest portal routes", () => {
    const expected = [
      "account.tsx",
      "account.index.tsx",
      "account.reservations.tsx",
      "account.reservations.index.tsx",
      "account.payments.tsx",
      "account.profile.tsx",
      "account.support.tsx",
    ];
    for (const f of expected) expect(files).toContain(f);
  });

  it("creates staff routes", () => {
    const expected = [
      "staff.tsx",
      "staff.index.tsx",
      "staff.reservations.tsx",
      "staff.reservations.index.tsx",
      "staff.calendar.tsx",
      "staff.seating.tsx",
      "staff.check-in.tsx",
      "staff.walk-ins.tsx",
      "staff.waitlist.tsx",
      "staff.guest-requests.tsx",
      "staff.communications.tsx",
    ];
    for (const f of expected) expect(files).toContain(f);
  });

  it("creates kitchen routes", () => {
    const expected = [
      "kitchen.tsx",
      "kitchen.index.tsx",
      "kitchen.preparation.tsx",
      "kitchen.meal-totals.tsx",
      "kitchen.dietary-notes.tsx",
      "kitchen.reports.tsx",
    ];
    for (const f of expected) expect(files).toContain(f);
  });

  it("creates admin routes", () => {
    const expected = [
      "admin.tsx",
      "admin.index.tsx",
      "admin.content.tsx",
      "admin.menus.tsx",
      "admin.users.tsx",
      "admin.roles.tsx",
      "admin.audit-log.tsx",
      "admin.settings.tsx",
      "admin.integrations.tsx",
    ];
    for (const f of expected) expect(files).toContain(f);
  });

  it("creates dynamic reservation detail routes", () => {
    expect(files).toContain("account.reservations.$reservationId.tsx");
    expect(files).toContain("staff.reservations.$reservationId.tsx");
  });
});

describe("dynamic route parameter handling", () => {
  it("account reservation detail uses $reservationId param", () => {
    const content = readFileSync(
      join(ROUTES_DIR, "account.reservations.$reservationId.tsx"),
      "utf-8",
    );
    expect(content).toContain("$reservationId");
    expect(content).toContain("useParams");
    expect(content).toContain("/account/reservations/$reservationId");
  });

  it("staff reservation detail uses $reservationId param", () => {
    const content = readFileSync(
      join(ROUTES_DIR, "staff.reservations.$reservationId.tsx"),
      "utf-8",
    );
    expect(content).toContain("$reservationId");
    expect(content).toContain("useParams");
    expect(content).toContain("/staff/reservations/$reservationId");
  });
});

describe("public navigation", () => {
  it("public layout links to all primary nav routes", () => {
    const content = readFileSync(
      join(ROUTES_DIR, "..", "components", "layout", "public-layout.tsx"),
      "utf-8",
    );
    const routes = [
      "/the-experience",
      "/menu",
      "/how-it-works",
      "/private-room",
      "/faq",
      "/waitlist",
      "/contact",
      "/sign-in",
    ];
    for (const to of routes) {
      // Accept either object-property form (`to: "/x"`) or JSX attribute form (`to="/x"`).
      const hasObjectForm = content.includes(`to: "${to}"`);
      const hasJsxForm = content.includes(`to="${to}"`);
      expect(hasObjectForm || hasJsxForm).toBe(true);
    }
    expect(content).toContain('to="/"');
  });
});

describe("no server-secret references in client modules", () => {
  const clientDirs = ["components", "lib/mock", "lib/domain", "lib"];

  it("client-safe modules do not reference process.env secrets", () => {
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
            // *.server.* modules are server-only by filename and are blocked
            // from the client bundle by the framework's import protection.
            // They legitimately reference server-side secrets.
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

  it("server-conventions module is type-only / placeholder (no real client)", () => {
    const content = readFileSync(
      join(process.cwd(), "src", "lib", "server-conventions.ts"),
      "utf-8",
    );
    expect(content).toContain("PLACEHOLDER");
    expect(content).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY\s*=/);
  });
});
