/**
 * Sit Down Sundays — Domain Types
 *
 * Framework-independent TypeScript interfaces for the core domain.
 * No mock data lives here. No server-only imports.
 *
 * Historical-data principles encoded in the shape:
 *  - Reservations carry pricing + policy snapshots.
 *  - Meal selections carry item-name + price snapshots.
 *  - Payments are financial events (not a single boolean).
 *  - Status changes preserve history.
 *  - Internal notes are typed separately from guest-visible notes.
 */

export type ISODateString = string;

/* ----------------------------- Identity ----------------------------- */

export type RoleKey =
  "guest" | "foh_staff" | "kitchen_staff" | "content_manager" | "ops_manager" | "administrator";

export interface Role {
  key: RoleKey;
  label: string;
  description: string;
}

export type PermissionKey =
  | "account.read_own"
  | "account.update_own"
  | "reservations.read_own"
  | "reservations.read_all"
  | "reservations.manage"
  | "seating.read"
  | "seating.manage"
  | "check_in.manage"
  | "walk_ins.manage"
  | "waitlist.read"
  | "waitlist.manage"
  | "kitchen.read"
  | "kitchen.reports"
  | "content.read_drafts"
  | "content.manage"
  | "content.publish"
  | "menus.manage"
  | "availability.manage"
  | "pricing.manage"
  | "payments.read"
  | "payments.manage"
  | "reports.read"
  | "users.read"
  | "users.manage"
  | "roles.manage"
  | "settings.manage"
  | "audit.read"
  | "integrations.manage";

export interface Permission {
  key: PermissionKey;
  label: string;
  category: string;
  description: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  roleKey: RoleKey;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface GuestProfile {
  id: string;
  userId: string;
  fullName: string;
  phone?: string;
  dietaryNotes?: string;
  preferredName?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/* ----------------------------- Menu ----------------------------- */

export type MenuCategory = "starter" | "main" | "side" | "dessert" | "beverage" | "children";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  category: MenuCategory;
  priceCents: number;
  allergens: string[];
  dietaryTags: string[];
  available: boolean;
  /**
   * Optional photograph of the dish.
   * Provisional in Phase 1; future CMS / Supabase media will populate this.
   * When absent, MenuItemCard renders a graceful neutral fallback.
   */
  imageUrl?: string;
  /** Meaningful alt text for the dish photograph (required when imageUrl is set). */
  imageAlt?: string;
}

export interface Menu {
  id: string;
  name: string;
  description: string;
  itemIds: string[];
  published: boolean;
}

/* ----------------------------- Availability ----------------------------- */

export type SundayServiceStatus = "scheduled" | "open" | "closed" | "completed";

export interface SundayService {
  id: string;
  date: ISODateString;
  label: string;
  status: SundayServiceStatus;
  seatingTimeIds: string[];
  privateRoomAvailable: boolean;
}

export interface SeatingTime {
  id: string;
  label: string;
  startISO: ISODateString;
  endISO: ISODateString;
  capacityTotal: number;
}

export type TableStatus = "available" | "held" | "seated" | "reserved" | "out_of_service";

export interface DiningTable {
  id: string;
  label: string;
  seats: number;
  zone: string;
  status: TableStatus;
  combinableWithIds: string[];
}

export interface PrivateRoom {
  id: string;
  name: string;
  minGuests: number;
  maxGuests: number;
  feeCents: number;
  available: boolean;
}

/* ----------------------------- Reservation ----------------------------- */

export type ReservationStatus =
  | "draft"
  | "booking_started"
  | "deposit_pending"
  | "confirmed"
  | "balance_due"
  | "paid_in_full"
  | "ready_for_service"
  | "checked_in"
  | "seated"
  | "completed"
  | "transfer_requested"
  | "cancellation_requested"
  | "cancelled"
  | "no_show"
  | "refund_review";

export type PaymentStatus =
  | "unpaid"
  | "deposit_pending"
  | "deposit_paid"
  | "partially_paid"
  | "balance_due"
  | "paid_in_full"
  | "partially_refunded"
  | "refunded"
  | "payment_failed"
  | "disputed";

export type ExperienceType = "standard" | "private_room";

export interface ReservationGuest {
  id: string;
  type: "adult" | "child" | "senior";
  count: number;
}

export interface ReservationMealSelection {
  id: string;
  menuItemId: string;
  /** Snapshot of the item name at time of booking. */
  itemNameSnapshot: string;
  /** Snapshot of the price at time of booking (cents). */
  priceCentsSnapshot: number;
  guestLabel?: string;
  quantity: number;
}

export interface PricingSnapshot {
  subtotalCents: number;
  discountTotalCents: number;
  privateRoomFeeCents: number;
  gratuityCents: number;
  serviceFeesCents: number;
  processingFeesCents: number;
  taxCents: number;
  grandTotalCents: number;
  depositRequiredCents: number;
  currency: string;
}

export interface PolicySnapshot {
  cancellationPolicySummary: string;
  depositPolicySummary: string;
  balanceDeadlinePolicySummary: string;
  capturedAt: ISODateString;
}

export interface ReservationStatusHistoryEntry {
  id: string;
  status: ReservationStatus;
  changedAt: ISODateString;
  changedByUserId?: string;
  note?: string;
}

export interface Reservation {
  id: string;
  confirmationNumber: string;
  guestOwnerId: string;
  sundayServiceId: string;
  seatingTimeId: string;
  experienceType: ExperienceType;
  privateRoomId?: string;
  partySize: number;
  partyComposition: ReservationGuest[];
  assignedTableIds: string[];
  guestNotes?: string;
  dietaryNotes?: string;
  /** Internal notes — must never appear in guest responses. */
  internalNotes?: string;
  mealSelections: ReservationMealSelection[];
  pricing: PricingSnapshot;
  policy: PolicySnapshot;
  status: ReservationStatus;
  paymentStatus: PaymentStatus;
  amountPaidCents: number;
  remainingBalanceCents: number;
  balanceDeadline?: ISODateString;
  statusHistory: ReservationStatusHistoryEntry[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/* ----------------------------- Payments ----------------------------- */

export type PaymentAdjustmentType =
  "deposit" | "balance" | "refund" | "chargeback" | "manual_adjustment";

export interface PaymentAdjustment {
  id: string;
  reservationId: string;
  type: PaymentAdjustmentType;
  amountCents: number;
  currency: string;
  processorReference?: string;
  occurredAt: ISODateString;
  recordedByUserId?: string;
  note?: string;
}

export interface Payment {
  id: string;
  reservationId: string;
  status: PaymentStatus;
  adjustments: PaymentAdjustment[];
  totalPaidCents: number;
  currency: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/* ----------------------------- Waitlist & Requests ----------------------------- */

export type WaitlistEntryStatus = "pending" | "invited" | "converted" | "declined" | "expired";

export interface WaitlistEntry {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  partySize: number;
  preferredSundays: string[];
  notes?: string;
  status: WaitlistEntryStatus;
  joinedAt: ISODateString;
}

export type GuestRequestStatus = "open" | "in_progress" | "resolved" | "escalated";

export interface GuestRequest {
  id: string;
  reservationId?: string;
  guestId?: string;
  subject: string;
  body: string;
  category: "general" | "dietary" | "transfer" | "cancellation" | "billing" | "other";
  status: GuestRequestStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/* ----------------------------- Content & Comms ----------------------------- */

export interface ContentSection {
  id: string;
  heading: string;
  body: string;
  order: number;
}

export interface ContentPage {
  id: string;
  slug: string;
  title: string;
  sections: ContentSection[];
  status: "draft" | "published";
  publishedAt?: ISODateString;
  updatedAt: ISODateString;
}

export interface MediaAsset {
  id: string;
  name: string;
  altText: string;
  url: string;
  mimeType: string;
  createdAt: ISODateString;
}

export interface EmailTemplate {
  id: string;
  key: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: ISODateString;
}

export type NotificationKind = "info" | "success" | "warning" | "alert";

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  createdAt: ISODateString;
}

/* ----------------------------- Audit ----------------------------- */

export interface AuditLog {
  id: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary: string;
  occurredAt: ISODateString;
}
