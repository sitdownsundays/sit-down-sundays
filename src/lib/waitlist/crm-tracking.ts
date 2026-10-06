/**
 * CRM form-tracking for the public waitlist form.
 *
 * Client-safe: contains only publishable integration IDs and custom-field IDs.
 * The webhook URL (a secret) is NOT here — it lives server-side only.
 *
 * Fires the platform external-tracking event so the lead lands in CRM tracking
 * and is filterable by workflow Form filters. Fired from the browser only after
 * a real successful server-side submission (honeypot traps and validation
 * failures send nothing).
 */
import { isHoneypotTriggered } from "./normalize";

// --- Integration IDs (publishable) -----------------------------------------
const TRACKING_ID = "tk_ea09695b3a1f4059bb962d5979f60af7";
const LOCATION_ID = "ap2yIMX9hKdh3baHD0K7";
const PROJECT_ID = "1790115564962639543";

// Stable slug per form — do not change after publish (workflow Form filter key).
const FORM_ID = "waitlist-form";
const FORM_NAME = "Sit Down Sundays Waitlist";

// --- Custom-field IDs (registered via the platform) ------------------------
// Standard fields (first_name, last_name, email, phone) use standard CRM keys.
// Non-standard fields use the IDs returned by register_custom_field.
const CUSTOM_FIELD = {
  partySize: "W62YuW3ecNm0vHpSXS2O",
  preferredSunday: "KpOqxgWGEANTE1gP1r7h",
  preferredSeatingTime: "oDzPSs31TnZpY3IaNGyT",
  privateRoomInterest: "ctIB3zqqXRvSihy8SUra",
  emailMarketingConsent: "isgL83meJTOwd7PRsIOF",
  smsConsent: "YqqoEKTvBgFyTXup4kmq",
} as const;

// --- Tracking helper types --------------------------------------------------
type StandardTrackingFieldKey = string;
type RegisteredCustomFieldId = string;
type TrackingCustomField = { value?: unknown; label: string };
type TrackingFileField = { file?: File; label: string };
type TrackingImageDataField = { dataUrl?: string; label: string };

const postTrackingEvent = (
  trackingPayload: Record<string, unknown> & {
    formData: Record<StandardTrackingFieldKey, unknown>;
    formLabels: Record<StandardTrackingFieldKey, string>;
  },
  options: {
    customFields?: Record<RegisteredCustomFieldId, TrackingCustomField>;
    fileFields?: Record<RegisteredCustomFieldId, TrackingFileField>;
    imageDataFields?: Record<RegisteredCustomFieldId, TrackingImageDataField>;
  } = {},
) => {
  const { customFields = {}, fileFields = {}, imageDataFields = {} } = options;
  const eventPayload = {
    ...trackingPayload,
    formData: { ...trackingPayload.formData },
    formLabels: { ...trackingPayload.formLabels },
  };
  const body = new FormData();

  for (const [key, field] of Object.entries(customFields)) {
    if (field.value === undefined) continue;
    eventPayload.formData[key] = field.value;
    eventPayload.formLabels[key] = field.label;
  }

  for (const [key, field] of Object.entries(imageDataFields)) {
    const dataUrl = field.dataUrl;
    if (!dataUrl) continue;
    if (!dataUrl.startsWith("data:image/")) {
      throw new Error("Image data field must be a data:image/* base64 string");
    }
    eventPayload.formData[key] = dataUrl;
    eventPayload.formLabels[key] = field.label;
  }

  for (const [key, field] of Object.entries(fileFields)) {
    const file = field.file;
    if (!file) continue;
    if (file.size > 50 * 1024 * 1024) {
      throw new Error("File must be 50 MB or smaller");
    }
    eventPayload.formData[key] = {
      filename: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    };
    eventPayload.formLabels[key] = field.label;
    body.append(key, file, file.name);
  }

  for (const key of Object.keys(eventPayload.formData)) {
    eventPayload.formLabels[key] ||= key;
  }

  body.append("event", JSON.stringify(eventPayload));

  fetch("https://backend.leadconnectorhq.com/external-tracking/events", {
    method: "POST",
    headers: {
      version: "2021-07-28",
    },
    body,
  }).catch(() => {}); // Fire-and-forget — don't block form UX
};

/** Shape of the form values at submit time (partySize is a string in the UI). */
export interface WaitlistFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  partySize: string;
  preferredDate: string;
  preferredSeatingTime: string;
  privateRoomInterest: boolean;
  emailMarketingConsent: boolean;
  smsConsent: boolean;
  /** Honeypot — must be empty for a real submission. */
  website: string;
}

/**
 * Fire the CRM form-tracking event for a successful waitlist join.
 * Caller must only invoke this after the server confirms success AND the
 * honeypot field is empty. Never call on validation failures or honeypot traps.
 */
export function trackWaitlistSubmission(values: WaitlistFormValues): void {
  // Defensive: never track a honeypot trap.
  if (isHoneypotTriggered(values.website)) return;

  const partySizeNum = Number(values.partySize);
  const partySize = Number.isFinite(partySizeNum) ? partySizeNum : undefined;

  const trackingPayload = {
    type: "external_form_submission",
    timestamp: Date.now(),
    formId: FORM_ID,
    formData: {
      first_name: values.firstName,
      last_name: values.lastName,
      email: values.email,
      phone: values.phone,
    },
    formLabels: {
      first_name: "First name",
      last_name: "Last name",
      email: "Email address",
      phone: "Mobile phone number",
    },
    url: window.location.href,
    title: document.title,
    path: window.location.pathname,
    userAgent: navigator.userAgent,
    trackingId: TRACKING_ID,
    locationId: LOCATION_ID,
    projectId: PROJECT_ID,
    sessionId: crypto.randomUUID(),
    properties: {
      deviceType: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop",
      source: "ai_studio",
      projectId: PROJECT_ID,
      formName: FORM_NAME,
    },
  };

  postTrackingEvent(trackingPayload, {
    customFields: {
      [CUSTOM_FIELD.partySize]: { value: partySize, label: "Party Size" },
      [CUSTOM_FIELD.preferredSunday]: {
        value: values.preferredDate || undefined,
        label: "Preferred Sunday",
      },
      [CUSTOM_FIELD.preferredSeatingTime]: {
        value: values.preferredSeatingTime || undefined,
        label: "Preferred Seating Time",
      },
      [CUSTOM_FIELD.privateRoomInterest]: {
        value: values.privateRoomInterest ? "Yes" : undefined,
        label: "Private Room Interest",
      },
      [CUSTOM_FIELD.emailMarketingConsent]: {
        value: values.emailMarketingConsent ? "Yes" : undefined,
        label: "Email Marketing Consent",
      },
      [CUSTOM_FIELD.smsConsent]: {
        value: values.smsConsent ? "Yes" : undefined,
        label: "SMS Consent",
      },
    },
  });
}
