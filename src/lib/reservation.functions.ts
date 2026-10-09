/**
 * Reservation model — server functions (thin client-safe wrappers).
 *
 * Components import these (NOT the *.server.ts helpers). The build replaces
 * their implementations with RPC stubs in client bundles, so server-only
 * modules, secrets, and the service-role client never enter the client
 * dependency graph.
 *
 * The submission core logic lives in reservation-submit.server.ts so it is
 * testable without the TanStack Start runtime context. These wrappers only
 * validate input and delegate.
 *
 * AUTHORIZATION:
 *  - Public submission (submitReservationRequest) does NOT require a session.
 *    It validates inputs, refetches authoritative config, recalculates prices,
 *    builds trusted snapshots, and persists through the atomic RPC. Client
 *    prices/totals/actors/status are NEVER trusted.
 *  - Staff list/detail resolve the CURRENT server-side Supabase user via
 *    resolveReservationStaffActor() (auth.getUser() — never trusting decoded
 *    cookies or a browser-supplied role) and require reservations.read_all.
 *  - Raw Supabase errors, credentials, and stack traces are never exposed.
 *
 * Requests remain pending_review / unpaid. No confirmed inventory, no
 * payment collection, no Stripe in this phase.
 */
import { createServerFn } from "@tanstack/react-start";
import { getReservationRepository } from "@/lib/server/reservation-repository.server";
import { resolveReservationStaffActor } from "@/lib/server/reservation-auth.server";
import { handleSubmitReservationRequest } from "@/lib/server/reservation-submit.server";
import { submitReservationRequestSchema, listReservationsSchema } from "@/lib/reservation/schema";
import { getOrderingRepository } from "@/lib/server/ordering-repository.server";
import { toPublicCatalog } from "@/lib/booking/public-catalog";
import type {
  PublicAvailabilityOption,
  SubmitReservationResult,
  ReservationListItemDTO,
  ReservationDetailDTO,
} from "@/lib/reservation/types";
import type { PublicOrderingCatalog } from "@/lib/booking/public-catalog";

/* ----------------------------- Public availability ----------------------------- */

export const getPublicAvailability = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { ok: true; options: PublicAvailabilityOption[] } | { ok: false; error: string }
  > => {
    try {
      const repo = getReservationRepository();
      const options = await repo.listPublicAvailability();
      return { ok: true, options };
    } catch {
      return { ok: false, error: "Availability is temporarily unavailable." };
    }
  },
);

/* ----------------------------- Public ordering catalog ----------------------------- */

/**
 * The customer-facing ordering catalog for the /reserve wizard's "Meals & extras"
 * step. Returns only ACTIVE packages/addons/platters and the public guest
 * pricing rules — no audit actors, timestamps, slugs, or admin-only fields.
 *
 * Public (no session required). Reads through the same ordering repository as
 * the admin config; the projection in toPublicCatalog strips admin-only data.
 * No direct browser Supabase access, no mock fallback in Supabase mode.
 */
export const getPublicOrderingCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { ok: true; catalog: PublicOrderingCatalog } | { ok: false; error: string }
  > => {
    try {
      const repo = getOrderingRepository();
      const config = await repo.getOrderingConfig();
      return { ok: true, catalog: toPublicCatalog(config) };
    } catch {
      return { ok: false, error: "Our menu is temporarily unavailable. Please try again." };
    }
  },
);

/* ----------------------------- Public submission ----------------------------- */

export const submitReservationRequest = createServerFn({ method: "POST" })
  .validator((d: unknown) => submitReservationRequestSchema.parse(d))
  .handler(async ({ data }): Promise<SubmitReservationResult> => {
    return handleSubmitReservationRequest(data);
  });

/* ----------------------------- Staff list ----------------------------- */

export const listReservations = createServerFn({ method: "GET" })
  .validator((d: unknown) => listReservationsSchema.parse(d))
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; reservations: ReservationListItemDTO[] } | { ok: false; error: string }
    > => {
      try {
        await resolveReservationStaffActor();
        const repo = getReservationRepository();
        const result = await repo.listReservations({
          sundayServiceId: data.sundayServiceId,
          seatingTimeId: data.seatingTimeId,
          status: data.status,
          search: data.search,
        });
        if (!result.success) {
          return { ok: false, error: result.error ?? "Reservations are temporarily unavailable." };
        }
        return { ok: true, reservations: result.reservations };
      } catch {
        return { ok: false, error: "You are not authorized to view reservations." };
      }
    },
  );

/* ----------------------------- Staff detail ----------------------------- */

export const getReservationDetail = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; reservation: ReservationDetailDTO } | { ok: false; error: string }> => {
      try {
        await resolveReservationStaffActor();
        const repo = getReservationRepository();
        const result = await repo.getReservation(data.id);
        if (!result.success || !result.reservation) {
          return { ok: false, error: result.error ?? "Reservation not found." };
        }
        return { ok: true, reservation: result.reservation };
      } catch {
        return { ok: false, error: "You are not authorized to view this reservation." };
      }
    },
  );
