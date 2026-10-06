/**
 * Menu-item image upload — client-safe types, constants, and validation.
 *
 * Framework-independent. No server-only imports. Shared by the UI field,
 * the server function, and tests so the rules agree.
 *
 * TRANSPORT: Seroval (TanStack Start's RPC serializer) cannot serialize
 * File/Blob across the server-function boundary, so the browser base64-
 * encodes the selected file. The server decodes and re-validates the REAL
 * content by magic bytes — never trusting the declared media type.
 */

/** Maximum accepted upload size: 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Storage bucket for menu photographs. Public-read assets. */
export const MENU_IMAGES_BUCKET = "menu-images";

/**
 * Accepted media types. SVG is intentionally excluded (security + it is not a
 * photograph). The server validates real content via magic bytes, not just
 * these declared strings.
 */
export const ACCEPTED_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageMediaType = (typeof ACCEPTED_IMAGE_MEDIA_TYPES)[number];

/** The accept attribute for the file input. */
export const ACCEPTED_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

/** Result of an upload server function call. */
export type ImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; kind: "validation" | "unauthorized" | "unexpected"; message: string };

/** A pending/finished upload tracked by the field component. */
export interface UploadState {
  status: "idle" | "uploading" | "done" | "error";
  /** Public URL once uploaded. */
  url: string | null;
  /** Safe message shown to the user on error. */
  error: string | null;
  /** File name for display. */
  fileName: string | null;
}

/**
 * Detect the real image format from magic bytes. Returns null for SVG, empty
 * data, or unsupported formats. This runs BOTH client-side (fast feedback)
 * and server-side (authoritative).
 *
 * Detection signatures:
 *  - JPEG: FF D8 FF
 *  - PNG:  89 50 4E 47 0D 0A 1A 0A
 *  - WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50 (RIFF....WEBP)
 */
export function detectImageFormat(bytes: Uint8Array): AcceptedImageMediaType | null {
  if (!bytes || bytes.length < 12) return null;
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x46 &&
    bytes[2] === 0x49 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** True when the file passes client-side format + size checks. */
export function isValidImageFile(file: File): { ok: true } | { ok: false; reason: string } {
  if (file.size === 0) return { ok: false, reason: "That file is empty." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: "Image must be 5 MB or smaller." };
  // Declared type quick check; real content validated server-side.
  const declared = file.type.toLowerCase();
  if (!ACCEPTED_IMAGE_MEDIA_TYPES.includes(declared as AcceptedImageMediaType)) {
    return { ok: false, reason: "Only JPEG, PNG, and WebP images are accepted." };
  }
  return { ok: true };
}

/** Read a File into a Uint8Array (browser). */
export function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result));
      else reject(new Error("Could not read file."));
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsArrayBuffer(file);
  });
}

/** Encode a Uint8Array to a base64 string (browser). */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Build a unique storage object path for a menu-item image. */
export function buildImageStoragePath(itemId: string, mediaType: AcceptedImageMediaType): string {
  const ext = mediaType === "image/jpeg" ? "jpg" : mediaType === "image/png" ? "png" : "webp";
  const unique = crypto.randomUUID();
  return `${itemId}/${unique}.${ext}`;
}
