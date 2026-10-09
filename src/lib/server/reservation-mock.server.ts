/**
 * SERVER-ONLY — mock reservation repository (local development only).
 *
 * In-memory, NOT live persistence. Never silently used in production
 * (env.server rejects mock mode in production). Behaves predictably for
 * development without pretending to be durable production data.
 */
import type {
  IReservationRepository,
  SubmitReservationRepoInput,
} from "./reservation-repository-interface.server";
import type {
  PublicAvailabilityOption,
  ReservationDetailDTO,
  ReservationListItemDTO,
  SubmitReservationResult,
} from "@/lib/reservation/types";
import { buildPublicAvailability } from "./reservation-availability.server";
import { getSundaysRepository } from "./sundays-repository.server";

interface MockStoredReservation extends ReservationDetailDTO {
  idempotencyKey: string;
  payloadHash: string;
}

const store: MockStoredReservation[] = [];

/** Reset the in-memory store (test utility; not used in production). */
export function resetMockReservationStore(): void {
  store.length = 0;
}

export class MockReservationRepository implements IReservationRepository {
  async listPublicAvailability(): Promise<PublicAvailabilityOption[]> {
    // Delegate to the shared availability builder so the mock uses the exact
    // same filtering rules (active general-dining space, "open" service,
    // active seating, positive limits at all levels, valid timezone, future
    // seating starts) as the Supabase repository.
    return buildPublicAvailability();
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<SubmitReservationResult | null> {
    const existing = store.find((r) => r.idempotencyKey === idempotencyKey);
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash) {
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "idempotency_key_mismatch",
        error: "This request key was used for a different reservation.",
      };
    }
    return {
      success: true,
      reservationId: existing.id,
      reservationNumber: existing.reservationNumber,
      status: existing.status,
      paymentStatus: existing.paymentStatus,
      idempotentReplay: true,
    };
  }

  async submitRequest(input: SubmitReservationRepoInput): Promise<SubmitReservationResult> {
    // Idempotency: same key + same hash returns existing; mismatch rejected.
    const existing = store.find((r) => r.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) {
        return {
          success: false,
          outcome: "proven_rejection",
          rejectionCode: "idempotency_key_mismatch",
          error: "This request key was used for a different reservation.",
        };
      }
      return {
        success: true,
        reservationId: existing.id,
        reservationNumber: existing.reservationNumber,
        status: existing.status,
        paymentStatus: existing.paymentStatus,
        idempotentReplay: true,
      };
    }

    // Resolve the selected service, seating, and space so the saved detail
    // reflects the actual chosen date/time/space — not hardcoded values.
    const sundays = getSundaysRepository();
    const [service, seatings] = await Promise.all([
      sundays.getSundayService(input.sundayServiceId),
      sundays.listSeatingTimesForService(input.sundayServiceId),
    ]);
    const seating = seatings.find((s) => s.id === input.seatingTimeId) ?? null;

    // Reject missing/mismatched service/seating references instead of saving
    // placeholder values.
    if (!service) {
      return { success: false, error: "Selected Sunday service is no longer available." };
    }
    if (!seating || seating.sundayServiceId !== service.id) {
      return { success: false, error: "Selected seating time is no longer available." };
    }

    // Resolve the real venue space name through service.spaceId.
    const spaces = (await import("./space-repository.server")).getSpaceRepository();
    const allSpaces = await spaces.listAllSpaces();
    const space = allSpaces.find((s) => s.id === service.spaceId) ?? null;
    const spaceName = space?.name ?? "Selected space";

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const detail: MockStoredReservation = {
      id,
      reservationNumber: input.reservationNumber,
      status: "pending_review",
      paymentStatus: "unpaid",
      experienceType: input.experienceType,
      contactFirstName: input.contactFirstName,
      contactLastName: input.contactLastName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      sundayServiceId: input.sundayServiceId,
      seatingTimeId: input.seatingTimeId,
      spaceName,
      serviceDate: service.date,
      seatingStartTime: seating.startTime,
      seatingEndTime: seating.endTime,
      partySize: input.partySize,
      adults: input.adults,
      seniors: input.seniors,
      children: input.children,
      guestNotes: input.guestNotes,
      dietaryNotes: input.dietaryNotes,
      accessibilityRequests: input.accessibilityRequests,
      occasion: input.occasion,
      internalNotes: "",
      subtotalCents: input.pricing.subtotalCents,
      depositRequiredCents: input.pricing.depositRequiredCents,
      grandTotalCents: input.pricing.grandTotalCents,
      amountPaidCents: 0,
      remainingBalanceCents: input.pricing.grandTotalCents,
      balanceDeadline: input.pricing.balanceDeadline,
      pricingSnapshot: input.pricing.pricingSnapshot,
      policySnapshot: input.pricing.policySnapshot,
      guests: input.snapshots.guests.map((g) => {
        // Merge per-guest notes from the raw validated input (not the pricing
        // snapshot, which intentionally excludes notes). Missing → empty string.
        const rawGuest = input.guests.find((rg) => rg.guestIndex === g.guestIndex);
        return {
          id: crypto.randomUUID(),
          guestIndex: g.guestIndex,
          guestCategory: g.category,
          guestName: g.name ? g.name : null,
          packageId: g.packageId,
          packageNameSnapshot: g.packageName,
          packagePriceSnapshot: g.packagePrice,
          // Preserve the dish NAME snapshot (and category) so admin/kitchen
          // display remains accurate after catalog changes — not raw UUIDs.
          includedSelections: g.included.map((s) => ({
            menuItemId: s.menuItemId,
            selectionCategory: s.category,
            name: s.name,
          })),
          addons: g.addons.map((a) => ({
            id: crypto.randomUUID(),
            addonId: a.addonId,
            addonNameSnapshot: a.name,
            pricePerUnitSnapshot: a.price,
            quantity: a.quantity,
          })),
          foodAllergies: rawGuest?.foodAllergies ?? "",
          dietaryPreferences: rawGuest?.dietaryPreferences ?? "",
          mealRequests: rawGuest?.mealRequests ?? "",
        };
      }),
      platters: input.snapshots.platters.map((p) => ({
        id: crypto.randomUUID(),
        platterId: p.platterId,
        platterNameSnapshot: p.name,
        pricePerPlatterSnapshot: p.price,
        quantity: p.quantity,
      })),
      createdAt: now,
      updatedAt: now,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    };
    store.push(detail);
    return {
      success: true,
      reservationId: id,
      reservationNumber: detail.reservationNumber,
      status: "pending_review",
      paymentStatus: "unpaid",
    };
  }

  async listReservations(filters: {
    sundayServiceId?: string;
    seatingTimeId?: string;
    status?: string;
    search?: string;
  }): Promise<{ success: boolean; reservations: ReservationListItemDTO[]; error?: string }> {
    let rows = [...store];
    if (filters.sundayServiceId)
      rows = rows.filter((r) => r.sundayServiceId === filters.sundayServiceId);
    if (filters.seatingTimeId) rows = rows.filter((r) => r.seatingTimeId === filters.seatingTimeId);
    if (filters.status) rows = rows.filter((r) => r.status === filters.status);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.reservationNumber.toLowerCase().includes(q) ||
          `${r.contactFirstName} ${r.contactLastName}`.toLowerCase().includes(q) ||
          r.contactEmail.toLowerCase().includes(q),
      );
    }
    return {
      success: true,
      reservations: rows.map((r) => ({
        id: r.id,
        reservationNumber: r.reservationNumber,
        status: r.status,
        paymentStatus: r.paymentStatus,
        contactName: `${r.contactFirstName} ${r.contactLastName}`,
        partySize: r.partySize,
        serviceDate: r.serviceDate,
        seatingStartTime: r.seatingStartTime,
        remainingBalanceCents: r.remainingBalanceCents,
        createdAt: r.createdAt,
      })),
    };
  }

  async getReservation(id: string): Promise<{
    success: boolean;
    reservation?: ReservationDetailDTO;
    error?: string;
  }> {
    const r = store.find((x) => x.id === id);
    if (!r) return { success: false, error: "Reservation not found." };
    const { idempotencyKey, payloadHash, ...rest } = r;
    return { success: true, reservation: rest };
  }
}
