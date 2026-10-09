/**
 * Menu-item image upload — authenticated server function (thin client-safe wrapper).
 *
 * Components import this (NOT the *.server.ts helpers). The build replaces its
 * implementation with an RPC stub in client bundles, so server-only modules,
 * secrets, and the service-role client never enter the client dependency graph.
 *
 * TRANSPORT NOTE: Seroval (TanStack Start's RPC serializer) cannot serialize
 * File/Blob objects across the server-function boundary, so the browser base64-
 * encodes the selected file and sends it as strings here. The server decodes
 * the bytes and reconstructs a File, then the repository validates the REAL
 * content via magic bytes — never trusting the declared mediaType. This keeps
 * the upload inside the established resolveMenuActor authorization path (no
 * duplicated session wiring in a separate server route).
 *
 * AUTHORIZATION:
 *  - Every upload resolves the CURRENT server-side Supabase user via
 *    resolveMenuActor() (auth.getUser() — never trusting decoded cookies or a
 *    browser-supplied role). Only content_manager, ops_manager, and
 *    administrator may upload.
 *  - Guest and unauthenticated requests are rejected before any storage write.
 *  - The service-role client is used only inside the .server.ts repository.
 *
 * Validation:
 *  - Rejects files over MAX_IMAGE_BYTES (checked on the decoded byte length).
 *  - Validates real content type server-side (magic bytes). SVG and unsupported
 *    files are rejected. Never trusts the declared mediaType.
 *  - Generates a unique storage path server-side so uploads never overwrite
 *    another item's image and never collide with concurrent uploads.
 *
 * Mock mode:
 *  - Simulates the upload in memory and returns a mock storage URL.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveMenuActor } from "@/lib/server/menu-auth.server";
import { hasMutationRole } from "@/lib/server/menu-shared.server";
import { getMenuUploadRepository } from "@/lib/server/menu-upload-repository.server";
import { getPublicDataMode } from "@/lib/server/env.server";
import { MAX_IMAGE_BYTES, type ImageUploadResult } from "@/lib/menu/image-upload";

const uploadSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(100),
    base64: z.string().min(1),
    itemId: z.string().min(1).max(100),
  })
  .strict();

/** Allowed MIME prefixes — the server still verifies real content via bytes. */
const ALLOWED_PREFIX = /^(image\/(jpeg|png|webp))$/;

async function requireUploadActor() {
  const actor = await resolveMenuActor();
  if (!actor || !hasMutationRole(actor.role)) {
    return {
      ok: false as const,
      kind: "unauthorized" as const,
      message: "You are not authorized to upload menu images.",
    };
  }
  return { ok: true as const, actor };
}

/** Decode a base64 string into a Uint8Array. */
function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Upload a menu-item photograph. The browser sends the file base64-encoded
 * (Seroval cannot serialize File/Blob). The server decodes it and validates the
 * real content before uploading to Storage.
 */
export const uploadMenuItemImage = createServerFn({ method: "POST" })
  .validator((raw: unknown) => uploadSchema.parse(raw))
  .handler(async ({ data }): Promise<ImageUploadResult> => {
    // Reject obviously invalid declared types early (authoritative byte check
    // still runs in the repository).
    if (!ALLOWED_PREFIX.test(data.mediaType.toLowerCase())) {
      return {
        ok: false,
        kind: "validation",
        message: "Only JPEG, PNG, and WebP images are accepted.",
      };
    }
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(data.base64);
    } catch {
      return {
        ok: false,
        kind: "validation",
        message: "The image data could not be read.",
      };
    }
    if (bytes.byteLength === 0) {
      return { ok: false, kind: "validation", message: "That file is empty." };
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        kind: "validation",
        message: "Image must be 5 MB or smaller.",
      };
    }
    try {
      const guard = await requireUploadActor();
      if (!guard.ok) return guard;
      const repo = getMenuUploadRepository();
      // Construct an ArrayBuffer-backed copy so the byte view is accepted as a
      // BlobPart under strict lib types. Preserves the exact validated byte
      // range without including unrelated backing-buffer bytes.
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const file = new File([buffer], data.fileName, { type: data.mediaType });
      return await repo.upload({ file, itemId: data.itemId }, guard.actor.userId);
    } catch {
      return {
        ok: false,
        kind: "unexpected",
        message: "The image could not be uploaded. Please try again.",
      };
    }
  });

/**
 * Public image-upload config — safe to return to the browser. Carries only the
 * data-mode label so the UI can show a development-only mock indicator. Never
 * secrets or URLs.
 */
export const getMenuImageUploadConfig = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return { dataMode: getPublicDataMode() } as const;
  } catch {
    return { dataMode: "supabase" as const };
  }
});
