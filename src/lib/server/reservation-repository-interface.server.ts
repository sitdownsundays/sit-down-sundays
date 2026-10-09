/**
 * SERVER-ONLY — reservation repository contract.
 * Implementations: MockReservationRepository (local dev),
 * SupabaseReservationRepository (prod). The caller MUST have already verified
 * the actor's role (staff/admin) before calling staff methods. Public
 * submission does not require a session actor (guest checkout).
 */
import type {
  PublicAvailabilityOption,
  ReservationDetailDTO,
  ReservationListItemDTO,
  SubmitReservationResult,
  ReservationPricingResult,
  ReservationGuestInput,
  ReservationPlatterInput,
} from "@/lib/reservation/types";
import type { ReservationSnapshots } from "./reservation-snapshot.server";

export interface SubmitReservationRepoInput {
  reservationNumber: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  sundayServiceId: string;
  seatingTimeId: string;
  experienceType: "standard" | "private_room";
  privateRoomId: string | null;
  partySize: number;
  adults: number;
  seniors: number;
  children: number;
  guestNotes: string;
  dietaryNotes: string;
  accessibilityRequests: string;
  occasion: string;
  pricing: ReservationPricingResult;
  guests: ReservationGuestInput[];
  platters: ReservationPlatterInput[];
  /** Trusted snapshots built from authoritative config (names/prices). */
  snapshots: ReservationSnapshots;
  idempotencyKey: string;
  payloadHash: string;
  /** Authenticated customer, or null for guest checkout. */
  actorUserId: string | null;
}

export interface IReservationRepository {
  /** Sanitized public availability options (no contact details). */
  listPublicAvailability(): Promise<PublicAvailabilityOption[]>;

  /**
   * Look up an existing submission by idempotency key + payload hash. Used to
   * short-circuit eligibility re-validation for a safe replay of an
   * already-saved request (whose seating/config may have since changed).
   * Returns the saved result shape WITHOUT re-pricing or re-validating.
   */
  findByIdempotencyKey(
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<SubmitReservationResult | null>;

  /** Public submission of an unpaid reservation REQUEST. Atomic. */
  submitRequest(input: SubmitReservationRepoInput): Promise<SubmitReservationResult>;

  /** Staff/admin list (requires reservations.read_all). */
  listReservations(filters: {
    sundayServiceId?: string;
    seatingTimeId?: string;
    status?: string;
    search?: string;
  }): Promise<{ success: boolean; reservations: ReservationListItemDTO[]; error?: string }>;

  /** Staff/admin detail (requires reservations.read_all). */
  getReservation(id: string): Promise<{
    success: boolean;
    reservation?: ReservationDetailDTO;
    error?: string;
  }>;
}
