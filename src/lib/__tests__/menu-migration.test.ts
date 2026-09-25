import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { MENU_CATEGORIES } from "@/lib/menu/constants";

const MIGRATION_PATH = join(process.cwd(), "supabase", "migrations", "0003_menu_catalog.sql");

function sql(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

/** SQL with `--` comment lines stripped, for structural/security assertions. */
function sqlCode(): string {
  return sql()
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("0003_menu_catalog.sql — structure", () => {
  it("creates menus, menu_sections, and menu_items", () => {
    const s = sql();
    expect(s).toMatch(/create table[^;]*public\.menus/i);
    expect(s).toMatch(/create table[^;]*public\.menu_sections/i);
    expect(s).toMatch(/create table[^;]*public\.menu_items/i);
  });

  it("does not modify or reapply 0001 or 0002", () => {
    const s = sqlCode();
    expect(s).not.toMatch(/waitlist_entries/i);
    expect(s).not.toMatch(/public\.profiles\b/i);
    expect(s).not.toMatch(/public\.roles\b/i);
    expect(s).not.toMatch(/\bdrop table\b/i);
    expect(s).not.toMatch(/\btruncate\b/i);
  });

  it("uses UUID primary keys on all three tables", () => {
    const s = sql();
    expect(s).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/i);
    const tableCount = (s.match(/create table if not exists public\./gi) ?? []).length;
    expect(tableCount).toBe(3);
  });

  it("menus has name, slug, description, status, display_order, publish dates", () => {
    const s = sql();
    expect(s).toMatch(/name\s+varchar\(160\)/i);
    expect(s).toMatch(/slug\s+varchar\(160\)/i);
    expect(s).toMatch(/status\s+varchar\(20\)/i);
    expect(s).toMatch(/display_order\s+integer/i);
    expect(s).toMatch(/publish_at\s+timestamptz/i);
    expect(s).toMatch(/unpublish_at\s+timestamptz/i);
  });

  it("menu_items stores price as integer cents", () => {
    const s = sql();
    expect(s).toMatch(/price_cents\s+integer not null default 0 check \(price_cents >= 0\)/i);
    expect(s).not.toMatch(/price\s+numeric/i);
    expect(s).not.toMatch(/price\s+real/i);
  });

  it("menu_items has image_url, image_alt, dietary_tags, allergens, active, featured", () => {
    const s = sql();
    expect(s).toMatch(/image_url\s+varchar\(2048\)/i);
    expect(s).toMatch(/image_alt\s+varchar\(300\)/i);
    expect(s).toMatch(/dietary_tags\s+text\[\]/i);
    expect(s).toMatch(/allergens\s+text\[\]/i);
    expect(s).toMatch(/is_active\s+boolean/i);
    expect(s).toMatch(/is_featured\s+boolean/i);
  });

  it("menu_items belongs to a menu and an optional section via a composite FK", () => {
    const s = sql();
    // menu_id is NOT NULL and cascades on menu delete.
    expect(s).toMatch(
      /menu_id\s+uuid not null references public\.menus\(id\)\s+on delete cascade/i,
    );
    // section_id is a bare nullable column; the composite FK is declared
    // separately at the end of the table (see the composite-FK tests).
    expect(s).toMatch(/section_id\s+uuid,/i);
  });

  it("menus and menu_items carry created_by and updated_by", () => {
    const s = sql();
    expect(s).toMatch(/created_by\s+uuid references auth\.users\(id\)\s+on delete set null/i);
    expect(s).toMatch(/updated_by\s+uuid references auth\.users\(id\)\s+on delete set null/i);
  });
});

describe("0003_menu_catalog.sql — constraints & indexes", () => {
  it("constrains menu status to draft/published/archived", () => {
    const s = sql();
    expect(s).toMatch(/status in \('draft','published','archived'\)/i);
  });

  it("constrains menu item category to the application MenuCategory values", () => {
    const s = sql();
    for (const c of MENU_CATEGORIES) {
      expect(s).toContain(`'${c}'`);
    }
  });

  it("enforces a unique active slug (partial unique index)", () => {
    const s = sql();
    expect(s).toMatch(
      /create unique index[^;]*uniq_menus_slug_active[^;]*where status <> 'archived'/i,
    );
  });

  it("adds useful indexes", () => {
    const s = sql();
    expect(s).toMatch(/idx_menus_status/i);
    expect(s).toMatch(/idx_menu_sections_menu/i);
    expect(s).toMatch(/idx_menu_items_menu/i);
    expect(s).toMatch(/idx_menu_items_active_featured/i);
  });

  it("display_order is non-negative", () => {
    const s = sql();
    expect(s).toMatch(/display_order\s+integer not null default 0 check \(display_order >= 0\)/i);
  });
});

describe("0003_menu_catalog.sql — RLS & public filtering", () => {
  it("enables RLS on all three tables", () => {
    const s = sql();
    expect(s).toMatch(/alter table public\.menus\s+enable row level security/i);
    expect(s).toMatch(/alter table public\.menu_sections\s+enable row level security/i);
    expect(s).toMatch(/alter table public\.menu_items\s+enable row level security/i);
  });

  it("exposes only published menus to anon/authenticated", () => {
    const s = sql();
    expect(s).toMatch(/menus_select_published.*status = 'published'/is);
  });

  it("exposes only active sections of published menus", () => {
    const s = sql();
    expect(s).toMatch(/menu_sections_select_published.*is_active = true/is);
    expect(s).toMatch(/menu_is_publicly_visible\(menu_id\)/i);
  });

  it("exposes only active items of published menus", () => {
    const s = sql();
    expect(s).toMatch(/menu_items_select_published.*is_active = true/is);
    expect(s).toMatch(/menu_is_publicly_visible\(menu_id\)/i);
  });

  it("has NO INSERT/UPDATE/DELETE policies for anon or authenticated", () => {
    const s = sql();
    const policies = s.match(/create policy[^;]+;/gis) ?? [];
    const joined = policies.join(" ");
    expect(joined).not.toMatch(/for insert/i);
    expect(joined).not.toMatch(/for update/i);
    expect(joined).not.toMatch(/for delete/i);
  });

  it("declares safe search paths on all database functions", () => {
    const s = sql();
    const fnCount = (s.match(/language (plpgsql|sql)/gi) ?? []).length;
    const safeCount = (s.match(/set search_path = public, pg_temp/gi) ?? []).length;
    expect(safeCount).toBeGreaterThanOrEqual(fnCount);
  });

  it("avoids destructive operations", () => {
    const s = sqlCode();
    expect(s).not.toMatch(/\bdrop table\b/i);
    expect(s).not.toMatch(/\bdrop schema\b/i);
    expect(s).not.toMatch(/\btruncate\b/i);
  });
});

describe("0003_menu_catalog.sql — correction: composite FK cross-menu section integrity", () => {
  it("provides a unique (id, menu_id) composite key on menu_sections", () => {
    const s = sql();
    expect(s).toMatch(
      /create unique index[^;]*uniq_menu_sections_id_menu[^;]*on public\.menu_sections\s+\(id, menu_id\)/is,
    );
  });

  it("declares a menu_items composite FK (section_id, menu_id) -> menu_sections(id, menu_id)", () => {
    const s = sql();
    expect(s).toMatch(
      /foreign key\s+\(section_id, menu_id\)\s+references public\.menu_sections\(id, menu_id\)/is,
    );
  });

  it("uses column-list ON DELETE SET NULL (section_id) so a section delete nulls only section_id", () => {
    const s = sql();
    expect(s).toMatch(/on delete set null\s+\(section_id\)/i);
  });

  it("keeps section_id nullable and menu_id NOT NULL on menu_items", () => {
    const s = sql();
    expect(s).toMatch(/section_id\s+uuid,/i);
    expect(s).toMatch(
      /menu_id\s+uuid not null references public\.menus\(id\)\s+on delete cascade/i,
    );
  });

  it("does not use a trigger-based same-menu guard function anymore", () => {
    const s = sql();
    expect(s).not.toMatch(/menu_item_section_same_menu/i);
    expect(s).not.toMatch(/trg_menu_item_section_same_menu/i);
    expect(s).not.toMatch(/different menu/i);
  });

  it("does not drop the menu_items table or cascade-delete items on section removal", () => {
    const s = sqlCode();
    expect(s).not.toMatch(/\bdrop table\b.*menu_items/i);
  });
});

describe("0003_menu_catalog.sql — correction: public items policy with sections", () => {
  it("exposes active items of published menus whose section (if any) is active & same-menu", () => {
    const s = sql();
    expect(s).toMatch(/menu_items_select_published/i);
    expect(s).toMatch(/is_active = true/is);
    expect(s).toMatch(/menu_is_publicly_visible\(menu_id\)/i);
    expect(s).toMatch(/menu_item_section_publicly_ok\(menu_id, section_id\)/i);
  });

  it("defines the section-visibility helper handling null section_id", () => {
    const s = sql();
    expect(s).toMatch(/menu_item_section_publicly_ok/i);
    expect(s).toMatch(/when p_section_id is null then true/is);
    expect(s).toMatch(/s\.menu_id = p_menu_id\s+and s\.is_active = true/is);
  });
});

describe("0003_menu_catalog.sql — correction: publish/unpublish ordering", () => {
  it("allows either date to be null individually", () => {
    const s = sql();
    expect(s).toMatch(
      /publish_at is null\s+or unpublish_at is null\s+or unpublish_at > publish_at/is,
    );
  });

  it("requires unpublish_at strictly later than publish_at when both present", () => {
    const s = sql();
    expect(s).toMatch(/unpublish_at > publish_at/i);
    expect(s).not.toMatch(/unpublish_at >= publish_at/i);
  });
});

describe("0003_menu_catalog.sql — correction: image alt accessibility", () => {
  it("requires image_alt when image_url is present and nonblank", () => {
    const s = sql();
    expect(s).toMatch(
      /nullif\(btrim\(image_url\), ''\) is null\s+or nullif\(btrim\(image_alt\), ''\) is not null/is,
    );
  });

  it("allows image_url to be null without alt text", () => {
    const s = sql();
    // image_url column is nullable (no NOT NULL on image_url)
    expect(s).toMatch(/image_url\s+varchar\(2048\),/i);
  });
});

describe("0003_menu_catalog.sql — correction: canonical slug format", () => {
  it("constrains slug to the canonical application pattern", () => {
    const s = sql();
    expect(s).toMatch(/slug ~ '\^\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\$'/i);
  });
});

describe("0003_menu_catalog.sql — correction: STABLE visibility helper", () => {
  it("marks menu_is_publicly_visible as STABLE", () => {
    const s = sql();
    expect(s).toMatch(/menu_is_publicly_visible[\s\S]*?language sql\s+stable/is);
  });
});

describe("0003_menu_catalog.sql — correction: comment accuracy", () => {
  it("references auth.users, not profiles or roles, for created_by/updated_by", () => {
    const s = sqlCode();
    expect(s).toMatch(/references auth\.users\(id\)/i);
  });

  it("does not claim IF NOT EXISTS repairs a partially applied schema", () => {
    const s = sql();
    expect(s).toMatch(/IF NOT EXISTS does NOT repair or alter a[\s\S]*partially applied schema/i);
  });
});
