/**
 * SERVER-ONLY — menu-item image upload repository (dispatch by data mode).
 *
 * Browser code never imports this (blocked by *.server.ts). Returns the active
 * repository based on APP_DATA_MODE. The service-role client is used only
 * inside the Supabase implementation; mock mode simulates uploads in memory.
 *
 * AUTHORIZATION is performed by the calling server function (resolveMenuActor)
 * BEFORE the repository runs. The repository trusts the verified actorUserId
 * only for audit/metadata — it is NOT authorization by itself.
 */
import { resolveDataMode } from "./env.server";
import { getAdminClient } from "./supabase-admin.server";
import {
  MAX_IMAGE_BYTES,
  MENU_IMAGES_BUCKET,
  detectImageFormat,
  buildImageStoragePath,
  type AcceptedImageMediaType,
  type ImageUploadResult,
} from "@/lib/menu/image-upload";

/** A validated upload request reaching the repository. */
export interface UploadRequest {
  /** Decoded file bytes (already size-checked by the server function). */
  file: File;
  /** Item the image belongs to (for path namespacing). */
  itemId: string;
}

export interface MenuUploadRepository {
  upload(req: UploadRequest, actorUserId: string): Promise<ImageUploadResult>;
}

/* ----------------------------- Mock repository ----------------------------- */

/**
 * Simulates uploads in mock mode. Returns a deterministic mock public URL so
 * the UI can preview without contacting Supabase. No real storage is touched.
 */
export class MockMenuUploadRepository implements MenuUploadRepository {
  async upload(req: UploadRequest): Promise<ImageUploadResult> {
    const bytes = new Uint8Array(await req.file.arrayBuffer());
    const format = detectImageFormat(bytes);
    if (!format) {
      return {
        ok: false,
        kind: "validation",
        message: "Only JPEG, PNG, and WebP images are accepted.",
      };
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, kind: "validation", message: "Image must be 5 MB or smaller." };
    }
    const ext = format === "image/jpeg" ? "jpg" : format === "image/png" ? "png" : "webp";
    const url = `mock://menu-images/${req.file.name || "image"}.${ext}`;
    return { ok: true, url };
  }
}

/* --------------------------- Supabase repository --------------------------- */

/**
 * Uploads to Supabase Storage using the service-role admin client (bypasses
 * RLS so authenticated-but-unauthorized users cannot exploit the bucket
 * policy directly — authorization is enforced server-side first). The
 * bucket is public-read; writes are restricted to the service role.
 *
 * Generates a unique path per upload (itemId + UUID + ext) so it never
 * overwrites another item's image and never collides with concurrent uploads.
 */
export class SupabaseMenuUploadRepository implements MenuUploadRepository {
  async upload(req: UploadRequest, _actorUserId: string): Promise<ImageUploadResult> {
    const bytes = new Uint8Array(await req.file.arrayBuffer());
    // Authoritative content validation via magic bytes (never trust the
    // declared media type from the browser).
    const format = detectImageFormat(bytes);
    if (!format) {
      return {
        ok: false,
        kind: "validation",
        message: "Only JPEG, PNG, and WebP images are accepted.",
      };
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, kind: "validation", message: "Image must be 5 MB or smaller." };
    }
    const path = buildImageStoragePath(req.itemId, format as AcceptedImageMediaType);
    try {
      const admin = getAdminClient();
      const { error } = await admin.storage
        .from(MENU_IMAGES_BUCKET)
        .upload(path, bytes, { contentType: format, upsert: false });
      if (error) {
        return {
          ok: false,
          kind: "unexpected",
          message: "The image could not be uploaded. Please try again.",
        };
      }
      const { data } = admin.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(path);
      return { ok: true, url: data.publicUrl };
    } catch {
      return {
        ok: false,
        kind: "unexpected",
        message: "The image could not be uploaded. Please try again.",
      };
    }
  }
}

let mockInstance: MockMenuUploadRepository | null = null;

/** Test-only: reset the mock upload repository. */
export function __resetMockUploadRepository(): void {
  mockInstance = null;
}

export function getMenuUploadRepository(): MenuUploadRepository {
  const { dataMode } = resolveDataMode();
  if (dataMode === "mock") {
    if (!mockInstance) mockInstance = new MockMenuUploadRepository();
    return mockInstance;
  }
  return new SupabaseMenuUploadRepository();
}
