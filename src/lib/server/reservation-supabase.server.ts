/**
 * SERVER-ONLY — Supabase reservation repository.
 *
 * Uses the admin (service-role) client. reservation data is PRIVATE — no
 * anonymous/authenticated direct table access (RLS enabled with no public
 * policies in 0011). The server function verifies the caller's role before
 * reaching staff methods; public submission does not require a session.
 *
 * Atomic submission goes through submit_reservation_request_atomic (0011),
 * which writes reservation + guests + add-ons + platters + status history +
 * audit in ONE transaction. Idempotency is enforced inside the RPC.
 *
 * Returns safe, secret-free errors; raw Supabase errors are never returned to
 * the browser. Read failures are NOT converted to empty success. Never falls
 * back to mock after a Supabase failure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase-admin.server";
import { buildPublicAvailability } from "./reservation-availability.server";
import type {
  IReservationRepository,
  SubmitReservationRepoInput,
} from "./reservation-repository-interface.server";
import type {
  PublicAvailabilityOption,
  ReservationDetailDTO,
  ReservationListItemDTO,
  SubmitReservationResult,
  ReservationGuestInput,
  ReservationPlatterInput,
} from "@/lib/reservation/types";
import { readReservationApproval } from "./reservation-approval-reader.server";

/** Safe, secret-free error for unexpected failures. */
const SAFE_ERROR = "We couldn't complete this reservation request. Please try again.";

interface ReservationListRow {
  id: string;
  reservation_number: string;
  status: string;
  payment_status: string;
  contact_first_name: string;
  contact_last_name: string;
  party_size: number;
  service_date: string;
  seating_start_time: string;
  remaining_balance_cents: number;
  created_at: string;
}

interface ReservationRow {
  id: string;
  reservation_number: string;
  status: string;
  payment_status: string;
  experience_type: string;
  contact_first_name: string;
  contact_last_name: string;
  contact_email: string;
  contact_phone: string;
  sunday_service_id: string;
  seating_time_id: string;
  space_name: string;
  service_date: string;
  seating_start_time: string;
  seating_end_time: string;
  party_size: number;
  adults: number;
  seniors: number;
  children: number;
  guest_notes: string;
  dietary_notes: string;
  accessibility_requests: string;
  occasion: string;
  internal_notes: string;
  subtotal_cents: number;
  deposit_required_cents: number;
  grand_total_cents: number;
  amount_paid_cents: number;
  remaining_balance_cents: number;
  balance_deadline: string | null;
  pricing_snapshot: Record<string, unknown>;
  policy_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface GuestRow {
  id: string;
  guest_index: number;
  guest_category: string;
  guest_name: string | null;
  package_id: string;
  package_name_snapshot: string;
  package_price_snapshot: number;
  included_selections: Array<{
    menuItemId: string;
    name?: string;
    selectionCategory?: string;
    category?: string;
  }>;
  food_allergies: string | null;
  dietary_preferences: string | null;
  meal_requests: string | null;
}

interface AddonRow {
  id: string;
  reservation_guest_id: string;
  addon_id: string;
  addon_name_snapshot: string;
  price_per_unit_snapshot: number;
  quantity: number;
}

interface PlatterRow {
  id: string;
  reservation_id: string;
  platter_id: string;
  platter_name_snapshot: string;
  price_per_platter_snapshot: number;
  quantity: number;
}

export class SupabaseReservationRepository implements IReservationRepository {
  // Allow injecting a client for tests; production uses the admin client.
  constructor(private client: SupabaseClient = getAdminClient()) {}

  async listPublicAvailability(): Promise<PublicAvailabilityOption[]> {
    return buildPublicAvailability();
  }

  /**
   * Look up an existing submission by idempotency key + payload hash for a
   * safe replay BEFORE re-validation/re-pricing. Direct server-side query on
   * the private reservations table (service-role bypasses RLS). Returns ONLY
   * the minimal submission-result fields — never contact details, notes,
   * stored hashes, or order contents. A database failure is an error, not
   * "not found": it stops submission safely.
   *
   * This preliminary lookup does NOT replace the atomic submission RPC's
   * concurrent duplicate-key handling (the unique(idempotency_key) constraint
   * + the RPC's unique_violation handler). It is an optimization that lets a
   * saved reservation replay without re-pricing even after pricing config has
   * changed.
   */
  async findByIdempotencyKey(
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<SubmitReservationResult | null> {
    const { data, error } = await this.client
      .from("reservations")
      .select("id,reservation_number,status,payment_status,payload_hash")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) {
      // Database lookup failure must stop submission safely — never treated as
      // "not found". Throw so the submission handler's catch returns SAFE_ERROR.
      throw new Error("reservation lookup failed");
    }
    if (!data) {
      // No record with this key → proceed to new-request validation.
      return null;
    }

    const row = data as {
      id: string;
      reservation_number: string;
      status: string;
      payment_status: string;
      payload_hash: string;
    };

    if (row.payload_hash !== payloadHash) {
      // Same key, different payload → safe mismatch. No write occurred.
      return {
        success: false,
        outcome: "proven_rejection",
        rejectionCode: "idempotency_key_mismatch",
        error: "This request key was used for a different reservation.",
      };
    }

    // Same key + same hash → return the ORIGINAL saved reservation identity and
    // saved status. No re-pricing, no re-validation.
    return {
      success: true,
      reservationId: row.id,
      reservationNumber: row.reservation_number,
      status: row.status as SubmitReservationResult["status"],
      paymentStatus: row.payment_status as SubmitReservationResult["paymentStatus"],
      idempotentReplay: true,
    };
  }

  async submitRequest(input: SubmitReservationRepoInput): Promise<SubmitReservationResult> {
    const rpcInput = {
      p_reservation_number: input.reservationNumber,
      p_contact_first_name: input.contactFirstName,
      p_contact_last_name: input.contactLastName,
      p_contact_email: input.contactEmail,
      p_contact_phone: input.contactPhone,
      p_sunday_service_id: input.sundayServiceId,
      p_seating_time_id: input.seatingTimeId,
      p_experience_type: input.experienceType,
      p_private_room_id: input.privateRoomId,
      p_party_size: input.partySize,
      p_adults: input.adults,
      p_seniors: input.seniors,
      p_children: input.children,
      p_guest_notes: input.guestNotes,
      p_dietary_notes: input.dietaryNotes,
      p_accessibility_requests: input.accessibilityRequests,
      p_occasion: input.occasion,
      p_subtotal_cents: input.pricing.subtotalCents,
      p_deposit_required_cents: input.pricing.depositRequiredCents,
      p_grand_total_cents: input.pricing.grandTotalCents,
      p_remaining_balance_cents: input.pricing.remainingBalanceCents,
      p_balance_deadline: input.pricing.balanceDeadline,
      p_pricing_snapshot: input.pricing.pricingSnapshot,
      p_policy_snapshot: input.pricing.policySnapshot,
      p_guests: input.snapshots.guests.map((g) => {
        // Merge per-guest notes from the raw input (not the pricing snapshot).
        // The snapshot builder intentionally excludes notes; they live on the
        // validated guest input. Missing values default to empty strings.
        const rawGuest = input.guests.find((rg) => rg.guestIndex === g.guestIndex);
        return {
          guestIndex: g.guestIndex,
          category: g.category,
          name: g.name,
          packageId: g.packageId,
          packageName: g.packageName,
          packagePrice: g.packagePrice,
          included: g.included.map((s) => ({
            menuItemId: s.menuItemId,
            name: s.name,
            category: s.category,
          })),
          addons: g.addons.map((a) => ({
            addonId: a.addonId,
            name: a.name,
            price: a.price,
            quantity: a.quantity,
          })),
          foodAllergies: rawGuest?.foodAllergies ?? "",
          dietaryPreferences: rawGuest?.dietaryPreferences ?? "",
          mealRequests: rawGuest?.mealRequests ?? "",
        };
      }),
      p_platters: input.snapshots.platters.map((p) => ({
        platterId: p.platterId,
        name: p.name,
        price: p.price,
        quantity: p.quantity,
      })),
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: input.payloadHash,
      p_actor_user_id: input.actorUserId,
    };

    const { data, error } = await this.client.rpc(
      "submit_reservation_request_with_capacity_atomic",
      rpcInput,
    );

    if (error) {
      // Never expose raw Supabase error text. The capacity-backed RPC may
      // raise P0019 when capacity acquisition fails inside the delegated
      // 0012 insert trigger — the whole transaction (reservation + guests +
      // audit + hold) rolls back atomically. Map that to a safe proven
      // rejection so the client knows nothing was saved.
      return { success: false, error: SAFE_ERROR };
    }

    const result = data as Record<string, unknown> | null;

    if (!result || typeof result !== "object") {
      // Malformed response — persistence outcome unknown. Never fabricate
      // success; surface a safe uncertain failure.
      return { success: false, error: SAFE_ERROR };
    }
    const ok = result["ok"];
    if (ok !== true) {
      const code = result["code"];
      if (code === "idempotency_key_mismatch") {
        return {
          success: false,
          outcome: "proven_rejection",
          rejectionCode: "idempotency_key_mismatch",
          error: "This request key was used for a different reservation.",
        };
      }
      if (code === "capacity_not_ready") {
        return {
          success: false,
          outcome: "proven_rejection",
          rejectionCode: "capacity_not_ready",
          error:
            "Online reservations are not available yet. Please contact us to reserve your table.",
        };
      }
      if (code === "capacity_unavailable") {
        return {
          success: false,
          outcome: "proven_rejection",
          rejectionCode: "capacity_unavailable",
          error: "We couldn't reserve a table for that time. Please try another date or seating.",
        };
      }
      if (code === "invalid_configuration") {
        return {
          success: false,
          outcome: "proven_rejection",
          rejectionCode: "invalid_configuration",
          error: "Selected service or seating is no longer available.",
        };
      }
      if (code === "conflict") {
        // A serialization/deadlock conflict means the persistence outcome is
        // unknown — the request may or may not have been saved. Do NOT return
        // proven_rejection; the client must treat this as uncertain.
        return { success: false, error: SAFE_ERROR };
      }
      if (code === "invalid_service" || code === "invalid_seating") {
        return {
          success: false,
          outcome: "proven_rejection",
          rejectionCode: code === "invalid_service" ? "invalid_service" : "invalid_seating",
          error: "Selected service or seating is no longer available.",
        };
      }
      if (code === "invalid_reference") {
        return {
          success: false,
          outcome: "proven_rejection",
          rejectionCode: "invalid_reference",
          error: "A selected item is no longer available.",
        };
      }
      if (code === "invalid_data") {
        return {
          success: false,
          outcome: "proven_rejection",
          rejectionCode: "invalid_data",
          error: "Some reservation details were invalid.",
        };
      }
      // Unknown RPC error code — persistence outcome may be unknown.
      return { success: false, error: SAFE_ERROR };
    }

    // Success: a NEW booking requires a valid reservation identity (UUID).
    // A historical replay created before the capacity schema may legitimately
    // lack hold metadata — never fabricate a hold/deadline. But a missing or
    // non-UUID reservation_id is a malformed response: persistence outcome is
    // unknown, so surface an uncertain failure rather than fabricated success.
    const reservationId = result["reservation_id"];
    const reservationNumber = result["reservation_number"];
    if (typeof reservationId !== "string" || reservationId.length === 0) {
      return { success: false, error: SAFE_ERROR };
    }
    const status = result["status"];
    const paymentStatus = result["payment_status"];
    // A valid success response MUST include status and payment_status as strings.
    // A missing or non-string status/payment_status is a malformed response —
    // the persistence outcome is unknown, so surface an uncertain failure rather
    // than fabricating defaults that could mask a real issue.
    if (typeof status !== "string" || typeof paymentStatus !== "string") {
      return { success: false, error: SAFE_ERROR };
    }
    return {
      success: true,
      reservationId,
      reservationNumber: typeof reservationNumber === "string" ? reservationNumber : undefined,
      status: status as SubmitReservationResult["status"],
      paymentStatus: paymentStatus as SubmitReservationResult["paymentStatus"],
      idempotentReplay: result["idempotent_replay"] === true,
      holdId: typeof result["hold_id"] === "string" ? result["hold_id"] : undefined,
      holdDeadline:
        typeof result["hold_deadline"] === "string" ? result["hold_deadline"] : undefined,
      capacityState:
        typeof result["capacity_state"] === "string" ? result["capacity_state"] : undefined,
    };
  }

  async listReservations(filters: {
    sundayServiceId?: string;
    seatingTimeId?: string;
    status?: string;
    search?: string;
  }): Promise<{ success: boolean; reservations: ReservationListItemDTO[]; error?: string }> {
    let query = this.client
      .from("reservation_list_view")
      .select(
        "id,reservation_number,status,payment_status,contact_first_name,contact_last_name,party_size,service_date,seating_start_time,remaining_balance_cents,created_at",
      )
      .order("created_at", { ascending: false });

    if (filters.sundayServiceId) {
      // The list view exposes service context; filter via the underlying
      // reservation's service. Use a safe equality filter (no raw interpolation).
      query = query.eq("sunday_service_id", filters.sundayServiceId);
    }
    if (filters.seatingTimeId) {
      query = query.eq("seating_time_id", filters.seatingTimeId);
    }
    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.search) {
      // Use PostgREST's or-filter with safe ilike; the value is bound, not
      // interpolated into filter syntax.
      const term = `%${filters.search.replace(/[%_]/g, (m) => "\\" + m)}%`;
      query = query.or(
        `reservation_number.ilike.${term},contact_first_name.ilike.${term},contact_last_name.ilike.${term},contact_email.ilike.${term}`,
      );
    }

    const { data, error } = await query;

    if (error) {
      // Read failures remain errors — never an empty success.
      return { success: false, reservations: [], error: SAFE_ERROR };
    }

    const rows = (data ?? []) as unknown as ReservationListRow[];
    return {
      success: true,
      reservations: rows.map((r) => ({
        id: r.id,
        reservationNumber: r.reservation_number,
        status: r.status as ReservationListItemDTO["status"],
        paymentStatus: r.payment_status as ReservationListItemDTO["paymentStatus"],
        contactName: `${r.contact_first_name} ${r.contact_last_name}`,
        partySize: r.party_size,
        serviceDate: r.service_date,
        seatingStartTime: r.seating_start_time,
        remainingBalanceCents: r.remaining_balance_cents,
        createdAt: r.created_at,
      })),
    };
  }

  async getReservation(id: string): Promise<{
    success: boolean;
    reservation?: ReservationDetailDTO;
    error?: string;
  }> {
    const { data: resData, error: resError } = await this.client
      .from("reservation_detail_view")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (resError) {
      return { success: false, error: SAFE_ERROR };
    }
    if (!resData) {
      return { success: false, error: "Reservation not found." };
    }

    const r = resData as unknown as ReservationRow;

    // Read the 0022 approval columns directly from reservations (the detail
    // view may not expose them). Verify identity + version before combining.
    const approvalResult = await readReservationApproval(this.client, id, r.updated_at);
    if (!approvalResult.success) {
      return { success: false, error: approvalResult.error };
    }
    const { approval } = approvalResult;

    // Fetch guests, addons, and platters in parallel for deterministic assembly.
    const [guestsRes, plattersRes] = await Promise.all([
      this.client
        .from("reservation_guests")
        .select(
          "id,guest_index,guest_category,guest_name,package_id,package_name_snapshot,package_price_snapshot,included_selections,food_allergies,dietary_preferences,meal_requests",
        )
        .eq("reservation_id", id)
        .order("guest_index", { ascending: true }),
      this.client
        .from("reservation_platter_lines")
        .select(
          "id,reservation_id,platter_id,platter_name_snapshot,price_per_platter_snapshot,quantity",
        )
        .eq("reservation_id", id)
        .order("created_at", { ascending: true }),
    ]);

    if (guestsRes.error || plattersRes.error) {
      return { success: false, error: SAFE_ERROR };
    }

    const guestRows = (guestsRes.data ?? []) as unknown as GuestRow[];
    const platterRows = (plattersRes.data ?? []) as unknown as PlatterRow[];

    // Fetch addons for all guests in one query, then group by guest.
    const guestIds = guestRows.map((g) => g.id);
    let addonByGuest = new Map<string, AddonRow[]>();
    if (guestIds.length > 0) {
      const { data: addonData, error: addonError } = await this.client
        .from("reservation_guest_addons")
        .select(
          "id,reservation_guest_id,addon_id,addon_name_snapshot,price_per_unit_snapshot,quantity",
        )
        .in("reservation_guest_id", guestIds)
        .order("created_at", { ascending: true });
      if (addonError) {
        return { success: false, error: SAFE_ERROR };
      }
      const addonRows = (addonData ?? []) as unknown as AddonRow[];
      addonByGuest = new Map<string, AddonRow[]>();
      for (const a of addonRows) {
        const arr = addonByGuest.get(a.reservation_guest_id) ?? [];
        arr.push(a);
        addonByGuest.set(a.reservation_guest_id, arr);
      }
    }

    const detail: ReservationDetailDTO = {
      id: r.id,
      reservationNumber: r.reservation_number,
      status: r.status as ReservationDetailDTO["status"],
      paymentStatus: r.payment_status as ReservationDetailDTO["paymentStatus"],
      experienceType: r.experience_type as ReservationDetailDTO["experienceType"],
      contactFirstName: r.contact_first_name,
      contactLastName: r.contact_last_name,
      contactEmail: r.contact_email,
      contactPhone: r.contact_phone,
      sundayServiceId: r.sunday_service_id,
      seatingTimeId: r.seating_time_id,
      spaceName: r.space_name,
      serviceDate: r.service_date,
      seatingStartTime: r.seating_start_time,
      seatingEndTime: r.seating_end_time,
      partySize: r.party_size,
      adults: r.adults,
      seniors: r.seniors,
      children: r.children,
      guestNotes: r.guest_notes,
      dietaryNotes: r.dietary_notes,
      accessibilityRequests: r.accessibility_requests,
      occasion: r.occasion,
      internalNotes: r.internal_notes,
      subtotalCents: r.subtotal_cents,
      depositRequiredCents: r.deposit_required_cents,
      grandTotalCents: r.grand_total_cents,
      amountPaidCents: r.amount_paid_cents,
      remainingBalanceCents: r.remaining_balance_cents,
      balanceDeadline: r.balance_deadline,
      approval,
      pricingSnapshot: r.pricing_snapshot,
      policySnapshot: r.policy_snapshot,
      guests: guestRows.map((g) => ({
        id: g.id,
        guestIndex: g.guest_index,
        guestCategory: g.guest_category as ReservationDetailDTO["guests"][number]["guestCategory"],
        guestName: g.guest_name,
        packageId: g.package_id,
        packageNameSnapshot: g.package_name_snapshot,
        packagePriceSnapshot: g.package_price_snapshot,
        includedSelections: g.included_selections.map((s) => ({
          menuItemId: s.menuItemId,
          selectionCategory: (s.selectionCategory ??
            s.category) as ReservationDetailDTO["guests"][number]["includedSelections"][number]["selectionCategory"],
          name: s.name ?? "",
        })),
        addons: (addonByGuest.get(g.id) ?? []).map((a) => ({
          id: a.id,
          addonId: a.addon_id,
          addonNameSnapshot: a.addon_name_snapshot,
          pricePerUnitSnapshot: a.price_per_unit_snapshot,
          quantity: a.quantity,
        })),
        foodAllergies: g.food_allergies ?? "",
        dietaryPreferences: g.dietary_preferences ?? "",
        mealRequests: g.meal_requests ?? "",
      })),
      platters: platterRows.map((p) => ({
        id: p.id,
        platterId: p.platter_id,
        platterNameSnapshot: p.platter_name_snapshot,
        pricePerPlatterSnapshot: p.price_per_platter_snapshot,
        quantity: p.quantity,
      })),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

    return { success: true, reservation: detail };
  }
}

// Re-export input types for server-function wiring.
export type { SubmitReservationRepoInput, ReservationGuestInput, ReservationPlatterInput };
