/** Server-only, read-only projections. Never return these rows to a browser. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SPACE_TYPES } from "@/lib/spaces/constants";
import { SUNDAY_STATUS_LABELS } from "@/lib/sundays/constants";
import type { SundayStatus } from "@/lib/sundays/constants";
import type { EligibilitySeating } from "./reservation-eligibility.server";

const integer = z.number().int().nonnegative().safe();
const resourceSchema = z.object({
  id: z.string().uuid(),
  space_id: z.string().uuid().nullable(),
  total_capacity: integer.positive(),
  parent_id: z.string().uuid().nullable(),
  resource_type: z.enum(["standalone", "whole", "section"]),
  is_active: z.boolean(),
});
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
const holdSchema = z
  .object({
    id: z.string().uuid(),
    capacity_resource_id: z.string().uuid(),
    party_size: integer.positive(),
    seating_start: instant,
    seating_end: instant,
    state: z.enum(["held", "allocated"]),
    released_at: z.null(),
  })
  .refine((row) => Date.parse(row.seating_end) > Date.parse(row.seating_start));

export type CapacityResourceRow = z.infer<typeof resourceSchema>;
export type CapacityHoldRow = z.infer<typeof holdSchema>;

export async function readCapacityControl(client: SupabaseClient) {
  const { data, error } = await client
    .from("capacity_control")
    .select("ready,revision")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error("Capacity control could not be read.");
  return z.object({ ready: z.boolean(), revision: integer }).parse(data);
}

interface Page {
  data: unknown;
  error: unknown;
  count: number | null;
}

/**
 * Never assume one PostgREST response contains every row. Exact counts also
 * detect a truncated response when the server's row limit is below our page
 * size. Revision checks in the caller reject mutations during pagination.
 */
async function readPages<T extends { id: string }>(
  fetchPage: (from: number, to: number) => PromiseLike<Page>,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let page = 0; page < 100; page++) {
    const response = await fetchPage(rows.length, rows.length + 499);
    if (response.error) throw new Error("Capacity records could not be read.");
    const count = integer.parse(response.count);
    if (total !== undefined && count !== total) throw new Error("Capacity changed during read.");
    total = count;
    const batch = z.array(schema).parse(response.data);
    for (const row of batch) {
      if (seen.has(row.id)) throw new Error("Duplicate capacity record.");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length === total) return rows;
    if (batch.length === 0 || rows.length > total) throw new Error("Incomplete capacity records.");
  }
  throw new Error("Capacity read limit exceeded.");
}

export async function readCapacityResources(client: SupabaseClient) {
  const rows = await readPages(
    (from, to) =>
      client
        .from("capacity_resources")
        .select("id,space_id,total_capacity,parent_id,resource_type,is_active", { count: "exact" })
        .order("id")
        .range(from, to),
    resourceSchema,
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const spaces = new Set<string>();
  for (const row of rows) {
    if (row.space_id !== null) {
      if (spaces.has(row.space_id)) throw new Error("Duplicate room mapping.");
      spaces.add(row.space_id);
    }
    if (row.resource_type === "section") {
      const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
      if (
        !row.space_id ||
        !parent ||
        parent.resource_type !== "whole" ||
        parent.parent_id !== null ||
        (row.is_active && !parent.is_active)
      ) {
        throw new Error("Invalid section hierarchy.");
      }
    } else if (
      row.parent_id !== null ||
      (row.resource_type === "whole" ? row.space_id !== null : row.space_id === null)
    ) {
      throw new Error("Invalid room hierarchy.");
    }
    const childTotal = rows
      .filter((child) => child.parent_id === row.id)
      .reduce((sum, child) => sum + child.total_capacity, 0);
    if (!Number.isSafeInteger(childTotal) || childTotal > row.total_capacity) {
      throw new Error("Section capacities exceed their parent.");
    }
  }
  return byId;
}

export async function readCapacityHolds(
  client: SupabaseClient,
  start: string,
  end: string,
): Promise<CapacityHoldRow[]> {
  // Deliberately no deadline filter: expired but unreleased holds still count.
  // Do not fetch customer, reservation, payment, or audit identities.
  return readPages(
    (from, to) =>
      client
        .from("reservation_capacity_holds")
        .select("id,capacity_resource_id,party_size,seating_start,seating_end,state,released_at", {
          count: "exact",
        })
        .is("released_at", null)
        .lt("seating_start", end)
        .gt("seating_end", start)
        .order("id")
        .range(from, to),
    holdSchema,
  );
}

/**
 * The legacy admin repositories turn some read failures into [] or default
 * policy values. Inventory reads cannot use those fallbacks. Read only the
 * eligibility fields here, validate every response, and propagate failures.
 */
export async function readCapacitySchedule(client: SupabaseClient) {
  const serviceSchema = z.object({
    id: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string(),
    space_id: z.string().uuid(),
    status: z.custom<SundayStatus>(
      (value) => typeof value === "string" && Object.hasOwn(SUNDAY_STATUS_LABELS, value),
    ),
    is_active: z.boolean(),
    online_booking_limit: integer.nullable(),
    capacity_resource_id: z.string().uuid().nullable(),
    display_order: integer,
  });
  const seatingSchema = z.object({
    id: z.string().uuid(),
    sunday_service_id: z.string().uuid(),
    label: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    is_active: z.boolean(),
    online_booking_limit: integer.nullable(),
    display_order: integer,
  });
  const spaceSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    space_type: z.enum(SPACE_TYPES),
    is_active: z.boolean(),
    online_booking_limit: integer.nullable(),
  });
  const [serviceRows, seatingRows, spaceRows, policyResponse] = await Promise.all([
    readPages(
      (from, to) =>
        client
          .from("sunday_services")
          .select(
            "id,date,label,space_id,status,is_active,online_booking_limit,capacity_resource_id,display_order",
            { count: "exact" },
          )
          .order("id")
          .range(from, to),
      serviceSchema,
    ),
    readPages(
      (from, to) =>
        client
          .from("seating_times")
          .select(
            "id,sunday_service_id,label,start_time,end_time,is_active,online_booking_limit,display_order",
            { count: "exact" },
          )
          .order("id")
          .range(from, to),
      seatingSchema,
    ),
    readPages(
      (from, to) =>
        client
          .from("venue_spaces")
          .select("id,name,space_type,is_active,online_booking_limit", { count: "exact" })
          .order("id")
          .range(from, to),
      spaceSchema,
    ),
    client.from("payment_policy").select("restaurant_timezone").eq("id", 1).maybeSingle(),
  ]);
  if (policyResponse.error) throw new Error("Scheduling policy could not be read.");
  const policyRow = z.object({ restaurant_timezone: z.string().min(1) }).parse(policyResponse.data);
  const services = serviceRows
    .sort((a, b) => a.display_order - b.display_order || a.date.localeCompare(b.date))
    .map((row) => ({
      id: row.id,
      date: row.date,
      label: row.label,
      spaceId: row.space_id,
      status: row.status,
      isActive: row.is_active,
      onlineBookingLimit: row.online_booking_limit,
      capacityResourceId: row.capacity_resource_id,
    }));
  const seatingsByService = new Map<string, EligibilitySeating[]>();
  for (const row of seatingRows.sort(
    (a, b) => a.display_order - b.display_order || a.start_time.localeCompare(b.start_time),
  )) {
    const list = seatingsByService.get(row.sunday_service_id) ?? [];
    list.push({
      id: row.id,
      sundayServiceId: row.sunday_service_id,
      label: row.label,
      startTime: row.start_time,
      endTime: row.end_time,
      isActive: row.is_active,
      onlineBookingLimit: row.online_booking_limit,
    });
    seatingsByService.set(row.sunday_service_id, list);
  }
  return {
    services,
    seatingsByService,
    spaces: spaceRows.map((row) => ({
      id: row.id,
      name: row.name,
      spaceType: row.space_type,
      isActive: row.is_active,
      onlineBookingLimit: row.online_booking_limit,
    })),
    policy: { restaurantTimezone: policyRow.restaurant_timezone },
  };
}
