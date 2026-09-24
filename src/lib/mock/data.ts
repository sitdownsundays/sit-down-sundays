/**
 * MOCK DATA LAYER
 * -----------------------------------------------------------------------------
 * All mock data lives under src/lib/mock/. Nothing here is real persistence.
 * In production mode this layer must NOT be used as a silent fallback.
 *
 * This module is clearly labeled development-only sample data. It must be
 * removable without rewriting the UI — components consume typed shapes,
 * not these modules directly in production.
 */
import type {
  DiningTable,
  GuestProfile,
  GuestRequest,
  MediaAsset,
  Menu,
  MenuItem,
  Notification,
  PrivateRoom,
  Reservation,
  SeatingTime,
  SundayService,
  User,
  WaitlistEntry,
} from "../domain";

export const MOCK_USERS: User[] = [
  {
    id: "usr_guest_1",
    email: "amelia@example.com",
    displayName: "Amelia Rivera",
    roleKey: "guest",
    createdAt: "2025-08-01T10:00:00Z",
    updatedAt: "2025-09-01T10:00:00Z",
  },
  {
    id: "usr_foh_1",
    email: "host@example.com",
    displayName: "Jordan Hale",
    roleKey: "foh_staff",
    createdAt: "2025-07-01T10:00:00Z",
    updatedAt: "2025-09-01T10:00:00Z",
  },
  {
    id: "usr_kitchen_1",
    email: "kitchen@example.com",
    displayName: "Sam Okafor",
    roleKey: "kitchen_staff",
    createdAt: "2025-07-01T10:00:00Z",
    updatedAt: "2025-09-01T10:00:00Z",
  },
  {
    id: "usr_admin_1",
    email: "admin@example.com",
    displayName: "Priya Shah",
    roleKey: "administrator",
    createdAt: "2025-06-01T10:00:00Z",
    updatedAt: "2025-09-01T10:00:00Z",
  },
];

export const MOCK_GUEST_PROFILES: GuestProfile[] = [
  {
    id: "gp_1",
    userId: "usr_guest_1",
    fullName: "Amelia Rivera",
    phone: "",
    dietaryNotes: "One guest vegetarian",
    preferredName: "Amelia",
    createdAt: "2025-08-01T10:00:00Z",
    updatedAt: "2025-09-01T10:00:00Z",
  },
];

/**
 * PROVISIONAL menu-item photographs.
 *
 * These are generated placeholder images, NOT approved brand assets.
 * Each path is centralized here so it can be swapped for CMS / Supabase
 * media later without touching components. Do not hard-code these inside
 * MenuItemCard. Recommended final assets: ~1200×900px, WebP/AVIF, warm
 * natural lighting, homestyle presentation, no embedded text or logos.
 */
export const MENU_ITEM_IMAGES = {
  mi_starter_1:
    "https://vibe.filesafe.space/1790115564962639543/assets/33db5fca-d77e-4a8c-91a6-ba21b41cf475.png",
  mi_main_1:
    "https://vibe.filesafe.space/1790115564962639543/assets/ee621779-dfaa-4bc9-a9bf-6792518839db.png",
  mi_main_2:
    "https://vibe.filesafe.space/1790115564962639543/assets/7619f478-251e-46df-a9bb-f34754b1a3e7.png",
  mi_side_1:
    "https://vibe.filesafe.space/1790115564962639543/assets/5304205d-33d1-446b-954d-193096fb1163.png",
  mi_dessert_1:
    "https://vibe.filesafe.space/1790115564962639543/assets/4cfad516-4091-42be-81af-1dd70552e6d0.png",
  mi_child_1:
    "https://vibe.filesafe.space/1790115564962639543/assets/ba61fe93-741a-4454-a6f5-f19262f2681e.png",
} as const;

export const MOCK_MENU_ITEMS: MenuItem[] = [
  {
    id: "mi_starter_1",
    name: "Sunday Bread & Dipping Oil",
    description: "Warm seeded loaf with herb-infused oil. Provisional menu item.",
    category: "starter",
    priceCents: 900,
    allergens: ["gluten"],
    dietaryTags: ["vegetarian"],
    available: true,
    imageUrl: MENU_ITEM_IMAGES.mi_starter_1,
    imageAlt:
      "A rustic seeded bread loaf torn in half on a wooden board with a ceramic dish of golden herb-infused dipping oil and rosemary.",
  },
  {
    id: "mi_main_1",
    name: "Slow-Braised Sunday Roast",
    description: "Provisional signature main. Final menu to be confirmed.",
    category: "main",
    priceCents: 2800,
    allergens: [],
    dietaryTags: [],
    available: true,
    imageUrl: MENU_ITEM_IMAGES.mi_main_1,
    imageAlt:
      "Sliced slow-braised beef roast plated on a ceramic dish with rich braising juices, roasted garlic, and thyme on a warm wooden table.",
  },
  {
    id: "mi_main_2",
    name: "Garden Vegetable Plate",
    description: "Seasonal vegetables with grains. Provisional menu item.",
    category: "main",
    priceCents: 2400,
    allergens: [],
    dietaryTags: ["vegetarian", "vegan"],
    available: true,
    imageUrl: MENU_ITEM_IMAGES.mi_main_2,
    imageAlt:
      "A garden vegetable plate with seasonal roasted vegetables, grains, and leafy greens dressed with herbs on a ceramic plate.",
  },
  {
    id: "mi_side_1",
    name: "Roasted Root Vegetables",
    description: "Provisional side. Final menu to be confirmed.",
    category: "side",
    priceCents: 800,
    allergens: [],
    dietaryTags: ["vegan"],
    available: true,
    imageUrl: MENU_ITEM_IMAGES.mi_side_1,
    imageAlt:
      "Caramelized roasted root vegetables — carrots, parsnips, and beets — in a rustic ceramic bowl with thyme on a wooden table.",
  },
  {
    id: "mi_dessert_1",
    name: "Sunday Pudding",
    description: "Provisional dessert. Final menu to be confirmed.",
    category: "dessert",
    priceCents: 1100,
    allergens: ["dairy", "egg"],
    dietaryTags: ["vegetarian"],
    available: true,
    imageUrl: MENU_ITEM_IMAGES.mi_dessert_1,
    imageAlt:
      "A Sunday pudding with glossy sauce on a ceramic plate with a spoon on a warm wooden table.",
  },
  {
    id: "mi_child_1",
    name: "Children's Plate",
    description: "Smaller portion for younger guests. Provisional.",
    category: "children",
    priceCents: 1200,
    allergens: [],
    dietaryTags: [],
    available: true,
    imageUrl: MENU_ITEM_IMAGES.mi_child_1,
    imageAlt:
      "A smaller child-friendly plate with simple roasted chicken, mashed potato, and steamed vegetables on a ceramic plate.",
  },
];

export const MOCK_MENUS: Menu[] = [
  {
    id: "menu_1",
    name: "Provisional Sunday Menu",
    description: "A working sample menu. Prices and items are provisional.",
    itemIds: MOCK_MENU_ITEMS.map((i) => i.id),
    published: false,
  },
];

export const MOCK_SEATING_TIMES: SeatingTime[] = [
  {
    id: "st_1",
    label: "Early Seating",
    startISO: "2025-09-28T12:00:00Z",
    endISO: "2025-09-28T14:00:00Z",
    capacityTotal: 60,
  },
  {
    id: "st_2",
    label: "Late Seating",
    startISO: "2025-09-28T18:00:00Z",
    endISO: "2025-09-28T20:30:00Z",
    capacityTotal: 60,
  },
];

export const MOCK_SUNDAY_SERVICES: SundayService[] = [
  {
    id: "ss_1",
    date: "2025-09-28",
    label: "Provisional Sunday — Late September",
    status: "scheduled",
    seatingTimeIds: ["st_1", "st_2"],
    privateRoomAvailable: true,
  },
  {
    id: "ss_2",
    date: "2025-10-05",
    label: "Provisional Sunday — Early October",
    status: "open",
    seatingTimeIds: ["st_1", "st_2"],
    privateRoomAvailable: false,
  },
];

export const MOCK_TABLES: DiningTable[] = [
  {
    id: "tbl_1",
    label: "T1",
    seats: 2,
    zone: "Main",
    status: "available",
    combinableWithIds: ["tbl_2"],
  },
  {
    id: "tbl_2",
    label: "T2",
    seats: 2,
    zone: "Main",
    status: "available",
    combinableWithIds: ["tbl_1"],
  },
  { id: "tbl_3", label: "T3", seats: 4, zone: "Main", status: "available", combinableWithIds: [] },
  {
    id: "tbl_4",
    label: "T4",
    seats: 6,
    zone: "Window",
    status: "available",
    combinableWithIds: [],
  },
  {
    id: "tbl_5",
    label: "T5",
    seats: 8,
    zone: "Window",
    status: "available",
    combinableWithIds: [],
  },
];

export const MOCK_PRIVATE_ROOMS: PrivateRoom[] = [
  {
    id: "pr_1",
    name: "The Family Room",
    minGuests: 8,
    maxGuests: 16,
    feeCents: 15000,
    available: true,
  },
];

export const MOCK_RESERVATIONS: Reservation[] = [
  {
    id: "res_1",
    confirmationNumber: "SDS-000001",
    guestOwnerId: "usr_guest_1",
    sundayServiceId: "ss_1",
    seatingTimeId: "st_1",
    experienceType: "standard",
    partySize: 4,
    partyComposition: [
      { id: "rg_1", type: "adult", count: 3 },
      { id: "rg_2", type: "child", count: 1 },
    ],
    assignedTableIds: ["tbl_3"],
    guestNotes: "Celebrating a birthday.",
    dietaryNotes: "One vegetarian adult.",
    internalNotes: "Mock reservation — internal note only.",
    mealSelections: [
      {
        id: "rms_1",
        menuItemId: "mi_main_1",
        itemNameSnapshot: "Slow-Braised Sunday Roast",
        priceCentsSnapshot: 2800,
        quantity: 2,
      },
      {
        id: "rms_2",
        menuItemId: "mi_main_2",
        itemNameSnapshot: "Garden Vegetable Plate",
        priceCentsSnapshot: 2400,
        quantity: 1,
      },
      {
        id: "rms_3",
        menuItemId: "mi_child_1",
        itemNameSnapshot: "Children's Plate",
        priceCentsSnapshot: 1200,
        quantity: 1,
      },
    ],
    pricing: {
      subtotalCents: 9200,
      discountTotalCents: 0,
      privateRoomFeeCents: 0,
      gratuityCents: 0,
      serviceFeesCents: 0,
      processingFeesCents: 0,
      taxCents: 0,
      grandTotalCents: 9200,
      depositRequiredCents: 4600,
      currency: "USD",
    },
    policy: {
      cancellationPolicySummary: "Provisional cancellation policy. Final language pending.",
      depositPolicySummary: "50% deposit required to confirm. Provisional.",
      balanceDeadlinePolicySummary: "Balance due before service. Provisional.",
      capturedAt: "2025-09-01T10:00:00Z",
    },
    status: "confirmed",
    paymentStatus: "deposit_paid",
    amountPaidCents: 4600,
    remainingBalanceCents: 4600,
    balanceDeadline: "2025-09-26T23:59:00Z",
    statusHistory: [
      { id: "sh_1", status: "draft", changedAt: "2025-09-01T09:00:00Z" },
      { id: "sh_2", status: "deposit_pending", changedAt: "2025-09-01T09:30:00Z" },
      { id: "sh_3", status: "confirmed", changedAt: "2025-09-01T10:00:00Z" },
    ],
    createdAt: "2025-09-01T09:00:00Z",
    updatedAt: "2025-09-01T10:00:00Z",
  },
];

export const MOCK_WAITLIST: WaitlistEntry[] = [
  {
    id: "wl_1",
    fullName: "Marcus Lee",
    email: "marcus@example.com",
    phone: "",
    partySize: 6,
    preferredSundays: ["2025-10-05"],
    notes: "Hoping for a window table.",
    status: "pending",
    joinedAt: "2025-09-02T10:00:00Z",
  },
  {
    id: "wl_2",
    fullName: "The Osei Family",
    email: "osei@example.com",
    phone: "",
    partySize: 10,
    preferredSundays: ["2025-09-28", "2025-10-05"],
    notes: "Interested in the private room.",
    status: "pending",
    joinedAt: "2025-09-03T10:00:00Z",
  },
];

export const MOCK_GUEST_REQUESTS: GuestRequest[] = [
  {
    id: "gr_1",
    reservationId: "res_1",
    guestId: "usr_guest_1",
    subject: "Adding a high chair",
    body: "Could we request a high chair for our youngest guest?",
    category: "general",
    status: "open",
    createdAt: "2025-09-02T10:00:00Z",
    updatedAt: "2025-09-02T10:00:00Z",
  },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: "nt_1",
    userId: "usr_foh_1",
    kind: "info",
    title: "New waitlist entry",
    body: "A party of 10 joined the waitlist.",
    read: false,
    createdAt: "2025-09-03T10:00:00Z",
  },
];

export const MOCK_MEDIA: MediaAsset[] = [
  {
    id: "media_1",
    name: "Sunday table placeholder",
    altText: "A warmly set Sunday dining table. Provisional image.",
    url: "",
    mimeType: "image/svg+xml",
    createdAt: "2025-09-01T10:00:00Z",
  },
];
