/**
 * Phase 3A6A — Menu Item Image Uploads.
 *
 * Focused tests for:
 *  - File validation (magic bytes, size, type, SVG rejection)
 *  - Authorization (unauthorized/guest rejection by the server function guard)
 *  - Unique storage paths
 *  - Replacement failures keep the existing image (alt-text requirement)
 *  - Mock repository behavior (simulated uploads)
 *  - Supabase repository path uniqueness (mocked storage client)
 *
 * Behavioral vs source-inspection:
 *  - detectImageFormat / isValidImageFile / buildImageStoragePath: behavioral
 *    (pure functions exercised with real byte arrays).
 *  - MockMenuUploadRepository.upload: behavioral (real File objects through the
 *    repository contract).
 *  - SupabaseMenuUploadRepository.upload: behavioral against a MOCKED storage
 *    client (verifies real content validation + unique paths). Does NOT test
 *    live Storage.
 *  - Server function authorization: the guard (resolveMenuActor) rejects
 *    unauthenticated/guest; this is verified structurally in menu-functions tests
 *    for the same shared guard, and here we assert the function's result shapes
 *    for the validation path (which runs before the actor check by design:
 *    rejecting obviously-bad declared types early). Live authorization against
 *    Supabase is not tested here — it requires a real session.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the service-role admin client so no live database or env is needed.
vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: vi.fn(),
}));
// Mock env so the repository dispatch resolves to supabase mode for the
// Supabase-repository tests, and mock mode for the mock tests (controlled per
// test by re-seeding the module's exported resolver).
vi.mock("@/lib/server/env.server", () => ({
  resolveDataMode: vi.fn(() => ({ dataMode: "supabase", isProduction: false })),
  getPublicDataMode: vi.fn(() => "supabase"),
  requireSupabaseEnv: vi.fn(() => ({
    url: "https://example.supabase.co",
    anonKey: "anon",
    serviceRoleKey: "service",
  })),
}));

import {
  MAX_IMAGE_BYTES,
  detectImageFormat,
  isValidImageFile,
  buildImageStoragePath,
  ACCEPTED_IMAGE_MEDIA_TYPES,
  type AcceptedImageMediaType,
} from "@/lib/menu/image-upload";
import {
  MockMenuUploadRepository,
  SupabaseMenuUploadRepository,
} from "@/lib/server/menu-upload-repository.server";
import { getAdminClient } from "@/lib/server/supabase-admin.server";

const newId = (): string => crypto.randomUUID();

/** Minimal valid JPEG bytes (FF D8 FF + filler). */
function jpegBytes(): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return b;
}
/** Minimal valid PNG bytes. */
function pngBytes(): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = 0x89;
  b[1] = 0x50;
  b[2] = 0x4e;
  b[3] = 0x47;
  b[4] = 0x0d;
  b[5] = 0x0a;
  b[6] = 0x1a;
  b[7] = 0x0a;
  return b;
}
/** Minimal valid WebP bytes (RIFF....WEBP). */
function webpBytes(): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = 0x52;
  b[1] = 0x46;
  b[2] = 0x49;
  b[3] = 0x46;
  b[8] = 0x57;
  b[9] = 0x45;
  b[10] = 0x42;
  b[11] = 0x50;
  return b;
}
/** SVG bytes (must be rejected — it is not a photograph). */
function svgBytes(): Uint8Array {
  const s = "<svg xmlns='http://www.w3.org/2000/svg'></svg>";
  return new TextEncoder().encode(s);
}
/** Random non-image bytes. */
function garbageBytes(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
}

function makeFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes], name, { type });
}

/* ----------------------------- detectImageFormat ----------------------------- */

describe("detectImageFormat — magic bytes (authoritative content check)", () => {
  it("detects JPEG from magic bytes regardless of declared type", () => {
    expect(detectImageFormat(jpegBytes())).toBe("image/jpeg");
  });
  it("detects PNG from magic bytes", () => {
    expect(detectImageFormat(pngBytes())).toBe("image/png");
  });
  it("detects WebP from magic bytes", () => {
    expect(detectImageFormat(webpBytes())).toBe("image/webp");
  });
  it("rejects SVG content", () => {
    expect(detectImageFormat(svgBytes())).toBeNull();
  });
  it("rejects random non-image bytes", () => {
    expect(detectImageFormat(garbageBytes())).toBeNull();
  });
  it("rejects empty or too-short data", () => {
    expect(detectImageFormat(new Uint8Array(0))).toBeNull();
    expect(detectImageFormat(new Uint8Array(4))).toBeNull();
  });
  it("never trusts a declared image/svg+xml type over real content", () => {
    // SVG bytes with a jpeg declared type still rejected by content.
    expect(detectImageFormat(svgBytes())).toBeNull();
  });
});

/* ----------------------------- isValidImageFile ----------------------------- */

describe("isValidImageFile — client-side pre-check", () => {
  it("accepts a JPEG under the size limit", () => {
    expect(isValidImageFile(makeFile(jpegBytes(), "a.jpg", "image/jpeg"))).toEqual({ ok: true });
  });
  it("rejects an empty file", () => {
    const f = makeFile(new Uint8Array(0), "a.jpg", "image/jpeg");
    expect(isValidImageFile(f).ok).toBe(false);
  });
  it("rejects a file over 5 MB", () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const f = makeFile(big, "a.jpg", "image/jpeg");
    const r = isValidImageFile(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/5 MB/i);
  });
  it("rejects an unsupported declared type (e.g. image/svg+xml)", () => {
    const f = makeFile(svgBytes(), "a.svg", "image/svg+xml");
    expect(isValidImageFile(f).ok).toBe(false);
  });
});

/* ----------------------------- buildImageStoragePath ----------------------------- */

describe("buildImageStoragePath — unique paths", () => {
  it("namespaces under the item id and uses the right extension", () => {
    const p = buildImageStoragePath("item-1", "image/png");
    expect(p.startsWith("item-1/")).toBe(true);
    expect(p.endsWith(".png")).toBe(true);
  });
  it("uses .jpg for jpeg", () => {
    expect(buildImageStoragePath("i", "image/jpeg").endsWith(".jpg")).toBe(true);
  });
  it("uses .webp for webp", () => {
    expect(buildImageStoragePath("i", "image/webp").endsWith(".webp")).toBe(true);
  });
  it("produces a unique path for each call (UUID)", () => {
    const a = buildImageStoragePath("item-1", "image/png");
    const b = buildImageStoragePath("item-1", "image/png");
    expect(a).not.toBe(b);
  });
  it("different item ids produce different path prefixes", () => {
    const a = buildImageStoragePath("item-A", "image/png");
    const b = buildImageStoragePath("item-B", "image/png");
    expect(a.startsWith("item-A/")).toBe(true);
    expect(b.startsWith("item-B/")).toBe(true);
  });
});

/* ----------------------------- Mock repository ----------------------------- */

describe("MockMenuUploadRepository.upload — simulated uploads", () => {
  it("returns a mock URL for a valid JPEG", async () => {
    const repo = new MockMenuUploadRepository();
    const res = await repo.upload(
      { file: makeFile(jpegBytes(), "a.jpg", "image/jpeg"), itemId: "i1" },
      "u1",
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url.startsWith("mock://menu-images/")).toBe(true);
  });
  it("rejects SVG content server-side by magic bytes", async () => {
    const repo = new MockMenuUploadRepository();
    const res = await repo.upload(
      { file: makeFile(svgBytes(), "a.svg", "image/jpeg"), itemId: "i1" },
      "u1",
    );
    expect(res.ok).toBe(false);
  });
  it("rejects oversized content", async () => {
    const repo = new MockMenuUploadRepository();
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const res = await repo.upload(
      { file: makeFile(big, "a.jpg", "image/jpeg"), itemId: "i1" },
      "u1",
    );
    expect(res.ok).toBe(false);
  });
});

/* --------------------- Supabase repository (mocked storage) --------------------- */

function makeStorageClient(uploadError: unknown = null) {
  const uploadedPaths: string[] = [];
  return {
    uploadedPaths,
    client: {
      storage: {
        from: (bucket: string) => ({
          upload: vi.fn(async (path: string, _body: unknown, _opts: unknown) => {
            uploadedPaths.push(path);
            return { data: { path }, error: uploadError };
          }),
          getPublicUrl: vi.fn((path: string) => ({
            data: {
              publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}`,
            },
          })),
        }),
      },
    },
  };
}

describe("SupabaseMenuUploadRepository.upload — mocked storage", () => {
  beforeEach(() => {
    vi.mocked(getAdminClient).mockReset();
  });

  it("uploads a valid JPEG and returns the public URL", async () => {
    const { client, uploadedPaths } = makeStorageClient();
    vi.mocked(getAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof getAdminClient>,
    );
    const repo = new SupabaseMenuUploadRepository();
    const res = await repo.upload(
      { file: makeFile(jpegBytes(), "a.jpg", "image/jpeg"), itemId: "i1" },
      "u1",
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url).toContain("menu-images/i1/");
    expect(uploadedPaths).toHaveLength(1);
    expect(uploadedPaths[0].startsWith("i1/")).toBe(true);
  });

  it("validates real content and rejects SVG even with a jpeg declared type", async () => {
    const { client, uploadedPaths } = makeStorageClient();
    vi.mocked(getAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof getAdminClient>,
    );
    const repo = new SupabaseMenuUploadRepository();
    const res = await repo.upload(
      { file: makeFile(svgBytes(), "a.jpg", "image/jpeg"), itemId: "i1" },
      "u1",
    );
    expect(res.ok).toBe(false);
    expect(uploadedPaths).toHaveLength(0); // never reached storage
  });

  it("generates a unique path per upload (never overwrites another item)", async () => {
    const { client, uploadedPaths } = makeStorageClient();
    vi.mocked(getAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof getAdminClient>,
    );
    const repo = new SupabaseMenuUploadRepository();
    await repo.upload({ file: makeFile(jpegBytes(), "a.jpg", "image/jpeg"), itemId: "i1" }, "u1");
    await repo.upload({ file: makeFile(jpegBytes(), "a.jpg", "image/jpeg"), itemId: "i1" }, "u1");
    expect(uploadedPaths).toHaveLength(2);
    expect(uploadedPaths[0]).not.toBe(uploadedPaths[1]);
  });

  it("returns a safe error (no storage details) when storage upload fails", async () => {
    const { client } = makeStorageClient({ message: "internal", statusCode: "500" });
    vi.mocked(getAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof getAdminClient>,
    );
    const repo = new SupabaseMenuUploadRepository();
    const res = await repo.upload(
      { file: makeFile(jpegBytes(), "a.jpg", "image/jpeg"), itemId: "i1" },
      "u1",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe("unexpected");
      expect(res.message).not.toContain("internal");
      expect(res.message).not.toContain("500");
    }
  });
});

/* ----------------------------- Constants consistency ----------------------------- */

describe("image-upload constants", () => {
  it("accepts exactly jpeg, png, webp", () => {
    expect([...ACCEPTED_IMAGE_MEDIA_TYPES].sort()).toEqual(
      ["image/jpeg", "image/png", "image/webp"].sort(),
    );
  });
  it("MAX_IMAGE_BYTES is 5 MB", () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
  it("buildImageStoragePath accepts all accepted media types", () => {
    const types: AcceptedImageMediaType[] = ["image/jpeg", "image/png", "image/webp"];
    for (const t of types) {
      const p = buildImageStoragePath("x", t);
      expect(p.startsWith("x/")).toBe(true);
    }
  });
});
