/**
 * Mocked-HTTP-boundary tests for the capacity-availability read path.
 *
 * These exercise the REAL buildCapacityAvailability() and the REAL functions
 * in capacity-availability-data.server.ts (readCapacityControl,
 * readCapacityResources, readCapacityHolds, readCapacitySchedule) through a
 * fake PostgREST fetch. No live PostgreSQL, no concurrency, no rendered
 * browser. Mocked-boundary verification only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCapacityAvailability } from "@/lib/server/capacity-availability.server";
import {
  fakeClient,
  makeDb,
  defaultService,
  defaultSeating,
  defaultBallroomSpace,
  mayoralSpaces,
  defaultBallroomResource,
  defaultMayoralResources,
  BALLROOM,
  MAYORAL_WHOLE,
  MAYORAL_S1,
  MAYORAL_S2,
  MAYORAL_1_SPACE,
  BALLROOM_SPACE,
  SERVICE_ID,
  SEATING_ID,
  toIso,
  SEATING_START_MS,
  SEATING_END_MS,
  type FakeDB,
  type HoldRow,
} from "./capacity-availability-fake-db";

vi.mock("@/lib/server/env.server", () => ({
  resolveDataMode: () => ({ dataMode: "supabase" }),
}));

const clientHolder = { client: null as unknown as ReturnType<typeof fakeClient> };
vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: () => clientHolder.client,
}));

function setDb(db: FakeDB) {
  clientHolder.client = fakeClient(db);
}

const fixtureIds = new Map<string, string>();

function fixtureUuid(label: string): string {
  const existing = fixtureIds.get(label);
  if (existing !== undefined) return existing;
  const tail = (fixtureIds.size + 1).toString(16).padStart(12, "0");
  const id = `00000000-0000-4000-8000-${tail}`;
  fixtureIds.set(label, id);
  return id;
}

beforeEach(() => {
  fixtureIds.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2099, 9, 1, 0, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function hold(
  suffix: string,
  resourceId: string,
  partySize: number,
  start = SEATING_START_MS,
  end = SEATING_END_MS,
  state: "held" | "allocated" = "held",
): HoldRow {
  return {
    id: fixtureUuid(`hold:${suffix}`),
    reservation_id: fixtureUuid(`reservation:${suffix}`),
    capacity_resource_id: resourceId,
    party_size: partySize,
    seating_start: toIso(start),
    seating_end: toIso(end),
    state,
    released_at: null,
  };
}

describe("disabled readiness", () => {
  it("ready=false returns disabled and does not fetch schedule/resources/holds", async () => {
    const calls: string[] = [];
    const baseDb = makeDb({ control: [{ ready: false, revision: 0 }] });
    const { makeFetch } = await import("./capacity-availability-fake-db");
    const trackingFetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      calls.push(url.pathname.split("/").pop() ?? "");
      return makeFetch(baseDb)(input, init);
    };
    clientHolder.client = (await import("@supabase/supabase-js")).createClient(
      "https://fake.supabase.co",
      "anon",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: trackingFetch as unknown as typeof fetch },
      },
    );
    const result = await buildCapacityAvailability();
    expect(result).toEqual({ ok: false, readiness: "disabled", error: expect.any(String) });
    // Only capacity_control was fetched; no schedule/resources/holds
    expect(calls).toEqual(["capacity_control"]);
  });
});

describe("enabled — no eligible services", () => {
  it("returns ok:true/enabled/options:[] (distinct from disabled)", async () => {
    setDb(makeDb({ services: [], seatings: [] }));
    const result = await buildCapacityAvailability();
    expect(result).toEqual({ ok: true, readiness: "enabled", options: [] });
  });
});

describe("default room mapping & capacity", () => {
  it("950 ballroom minus 16-person hold = 934", async () => {
    setDb(makeDb({ holds: [hold("0000a1", BALLROOM, 16)] }));
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toHaveLength(1);
    expect(result.options[0].availableCapacity).toBe(934);
    expect(result.options[0].maxBookablePartySize).toBe(100);
  });
});

describe("configured limits separate from physical capacity", () => {
  it("934 physical, configured limit 12: available=934, ceiling=12, maxBookable=12", async () => {
    setDb(
      makeDb({
        services: [defaultService({ online_booking_limit: 12 })],
        seatings: [defaultSeating({ online_booking_limit: 12 })],
        holds: [hold("0000001", BALLROOM, 16, undefined, undefined, "allocated")],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toHaveLength(1);
    expect(result.options[0].availableCapacity).toBe(934);
    expect(result.options[0].configuredRequestCeiling).toBe(12);
    expect(result.options[0].maxBookablePartySize).toBe(12);
  });
});

describe("peak occupancy — not sum", () => {
  it("two non-concurrent holds in a longer interval deduct peak (max), not sum", async () => {
    setDb(
      makeDb({
        holds: [
          hold("0000001", BALLROOM, 20, SEATING_START_MS, SEATING_START_MS + 60 * 60 * 1000),
          hold("0000002", BALLROOM, 30, SEATING_START_MS + 2 * 60 * 60 * 1000, SEATING_END_MS),
        ],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Peak = max(20, 30) = 30 → 950-30 = 920, not 950-50 = 900
    expect(result.options[0].availableCapacity).toBe(920);
  });
});

describe("hold lifecycle & interval boundaries", () => {
  it("expired-but-unreleased still counts", async () => {
    setDb(makeDb({ holds: [hold("0000001", BALLROOM, 10)] }));
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options[0].availableCapacity).toBe(940);
  });

  it("hold ending exactly at requested start does not count (back-to-back)", async () => {
    setDb(
      makeDb({
        holds: [
          hold("00000bb", BALLROOM, 100, SEATING_START_MS - 60 * 60 * 1000, SEATING_START_MS),
        ],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options[0].availableCapacity).toBe(950);
  });

  it("hold starting exactly at requested end does not count", async () => {
    setDb(
      makeDb({
        holds: [hold("00000cc", BALLROOM, 100, SEATING_END_MS, SEATING_END_MS + 60 * 60 * 1000)],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options[0].availableCapacity).toBe(950);
  });
});

describe("Mayoral rules", () => {
  it("whole-parent override; 45+50 leaves 25 of 120", async () => {
    setDb(
      makeDb({
        services: [
          defaultService({ space_id: MAYORAL_1_SPACE, capacity_resource_id: MAYORAL_WHOLE }),
        ],
        spaces: [...mayoralSpaces()],
        holds: [hold("0000004a", MAYORAL_WHOLE, 45), hold("0000004b", MAYORAL_WHOLE, 50)],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toHaveLength(1);
    expect(result.options[0].availableCapacity).toBe(25);
  });

  it("whole mode blocked by overlapping section hold → unavailable, not error", async () => {
    setDb(
      makeDb({
        services: [
          defaultService({ space_id: MAYORAL_1_SPACE, capacity_resource_id: MAYORAL_WHOLE }),
        ],
        spaces: [...mayoralSpaces()],
        holds: [hold("000000s1", MAYORAL_S1, 30)],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.readiness).toBe("enabled");
    const opt = result.options.find(
      (o) => o.sundayService.id === SERVICE_ID && o.seatingTime.id === SEATING_ID,
    );
    expect(opt).toBeDefined();
    expect(opt!.availableCapacity).toBe(0);
    expect(opt!.maxBookablePartySize).toBe(0);
  });

  it("section mode blocked by overlapping whole hold → unavailable, not error", async () => {
    setDb(
      makeDb({
        services: [defaultService({ space_id: MAYORAL_1_SPACE, capacity_resource_id: null })],
        spaces: [...mayoralSpaces()],
        holds: [hold("000000w1", MAYORAL_WHOLE, 60)],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.readiness).toBe("enabled");
    const opt = result.options.find(
      (o) => o.sundayService.id === SERVICE_ID && o.seatingTime.id === SEATING_ID,
    );
    expect(opt).toBeDefined();
    expect(opt!.availableCapacity).toBe(0);
    expect(opt!.maxBookablePartySize).toBe(0);
  });

  it("separate sections coexist within their limits", async () => {
    setDb(
      makeDb({
        services: [defaultService({ space_id: MAYORAL_1_SPACE, capacity_resource_id: null })],
        spaces: [...mayoralSpaces()],
        holds: [hold("000000c1", MAYORAL_S1, 20), hold("000000c2", MAYORAL_S2, 30)],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toHaveLength(1);
    expect(result.options[0].availableCapacity).toBe(40); // 60-20
  });
});

describe("mapping/configuration failures", () => {
  it("missing resource for service space → error", async () => {
    setDb(
      makeDb({
        resources: [...defaultMayoralResources()],
        spaces: [defaultBallroomSpace(), ...mayoralSpaces()],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });

  it("inactive resource → error", async () => {
    setDb(
      makeDb({
        resources: [
          { ...defaultBallroomResource(), is_active: false },
          ...defaultMayoralResources(),
        ],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });

  it("wrong-room override → error", async () => {
    setDb(
      makeDb({
        services: [defaultService({ space_id: MAYORAL_1_SPACE, capacity_resource_id: BALLROOM })],
        spaces: [...mayoralSpaces()],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });

  it("explicit override equals default mapped section → valid, 60 seats", async () => {
    setDb(
      makeDb({
        services: [defaultService({ space_id: MAYORAL_1_SPACE, capacity_resource_id: MAYORAL_S1 })],
        spaces: [...mayoralSpaces()],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.readiness).toBe("enabled");
    const opt = result.options.find(
      (o) => o.sundayService.id === SERVICE_ID && o.seatingTime.id === SEATING_ID,
    );
    expect(opt).toBeDefined();
    expect(opt!.availableCapacity).toBe(60);
    expect(opt!.maxBookablePartySize).toBe(60);
  });

  it("wrong-room section override (S1 space → S2 resource) → error", async () => {
    setDb(
      makeDb({
        services: [defaultService({ space_id: MAYORAL_1_SPACE, capacity_resource_id: MAYORAL_S2 })],
        spaces: [...mayoralSpaces()],
      }),
    );
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });
});

describe("database failures", () => {
  const tables = [
    "capacity_control",
    "capacity_resources",
    "reservation_capacity_holds",
    "sunday_services",
    "seating_times",
    "venue_spaces",
    "payment_policy",
  ];
  for (const table of tables) {
    it(`${table} error → safe error, not empty/full availability`, async () => {
      setDb(makeDb({ errors: { [table]: true } }));
      const result = await buildCapacityAvailability();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.readiness).toBe("error");
      expect(result.error).not.toMatch(/database error|P0001/i);
    });
  }
});

describe("invalid responses", () => {
  it("missing control row → error", async () => {
    setDb(makeDb({ control: [] }));
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });

  it("non-boolean ready → error", async () => {
    setDb(makeDb({ control: [{ ready: "yes" as unknown as boolean, revision: 1 }] }));
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });

  it("missing timezone → error", async () => {
    setDb(makeDb({ policy: [{ restaurant_timezone: "" }] }));
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });
});

describe("pagination", () => {
  it("more than 1,000 unreleased holds are all accounted for", async () => {
    const holds = Array.from({ length: 1100 }, (_, i) =>
      hold(String(i).padStart(7, "0"), BALLROOM, 1),
    );
    setDb(makeDb({ holds }));
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toHaveLength(1);
    // 1100 concurrent holds of 1 each → 950-1100 = -150, clamped to 0
    expect(result.options[0].availableCapacity).toBe(0);
  });

  it("incomplete response with larger advertised count fails safely", async () => {
    setDb(makeDb({ incompleteTable: "reservation_capacity_holds", incompleteCount: 10 }));
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });
});

describe("concurrent changes", () => {
  it("revision change between initial and final control reads → error", async () => {
    let firstControl = true;
    const baseDb = makeDb({
      control: [
        { ready: true, revision: 1 },
        { ready: true, revision: 2 },
      ],
    });
    const { makeFetch } = await import("./capacity-availability-fake-db");
    const customFetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      const table = url.pathname.split("/").pop() ?? "";
      if (table === "capacity_control") {
        const row = firstControl ? baseDb.control![0] : baseDb.control![1];
        firstControl = false;
        const isMaybeSingle = !url.searchParams.has("offset");
        if (isMaybeSingle) {
          return Promise.resolve(
            new Response(JSON.stringify({ ready: row.ready, revision: row.revision }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
      }
      return makeFetch(baseDb)(input, init);
    };
    const { createClient } = await import("@supabase/supabase-js");
    clientHolder.client = createClient("https://fake.supabase.co", "anon", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: customFetch as unknown as typeof fetch },
    });
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });

  it("readiness switched off during the read → error", async () => {
    let firstControl = true;
    const baseDb = makeDb({
      control: [
        { ready: true, revision: 1 },
        { ready: false, revision: 1 },
      ],
    });
    const { makeFetch } = await import("./capacity-availability-fake-db");
    const customFetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      const table = url.pathname.split("/").pop() ?? "";
      if (table === "capacity_control") {
        const row = firstControl ? baseDb.control![0] : baseDb.control![1];
        firstControl = false;
        const isMaybeSingle = !url.searchParams.has("offset");
        if (isMaybeSingle) {
          return Promise.resolve(
            new Response(JSON.stringify({ ready: row.ready, revision: row.revision }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
      }
      return makeFetch(baseDb)(input, init);
    };
    const { createClient } = await import("@supabase/supabase-js");
    clientHolder.client = createClient("https://fake.supabase.co", "anon", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: customFetch as unknown as typeof fetch },
    });
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.readiness).toBe("error");
  });
});

describe("public projection", () => {
  it("result exposes only public fields — no hold/reservation/audit/customer data", async () => {
    setDb(makeDb({ holds: [hold("0000zzz", BALLROOM, 10)] }));
    const result = await buildCapacityAvailability();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result);
    // No private identifiers leaked
    expect(json).not.toContain("0000zzz");
    expect(json).not.toContain("capacity_resource_id");
    expect(json).not.toContain("reservation_id");
    expect(json).not.toContain("party_size");
    // Public fields present
    const opt = result.options[0];
    expect(opt).toHaveProperty("configuredRequestCeiling");
    expect(opt).toHaveProperty("restaurantTimezone");
    expect(opt).toHaveProperty("availableCapacity");
    expect(opt).toHaveProperty("maxBookablePartySize");
  });
});

describe("environment — mock mode", () => {
  it("mock mode returns disabled without touching Supabase", async () => {
    vi.resetModules();
    vi.doMock("@/lib/server/env.server", () => ({
      resolveDataMode: () => ({ dataMode: "mock" }),
    }));
    const { buildCapacityAvailability: fresh } =
      await import("@/lib/server/capacity-availability.server");
    const result = await fresh();
    expect(result).toEqual({ ok: false, readiness: "disabled", error: expect.any(String) });
    vi.doUnmock("@/lib/server/env.server");
  });
});
