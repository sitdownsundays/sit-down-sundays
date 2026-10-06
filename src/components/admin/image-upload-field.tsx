/**
 * ImageUploadField — menu-item photo upload control (client-safe component).
 *
 * Lets CMS staff choose a food photo instead of pasting a URL. Validates the
 * file client-side (size + declared type + magic bytes) for fast feedback,
 * then base64-encodes it and calls the upload server function. The server
 * re-validates the REAL content by magic bytes authoritatively.
 *
 * Behavior:
 *  - Preview + progress/busy state + accessible errors + retry.
 *  - Alt text is required before saving an item WITH an image (enforced by the
 *    item form's own validation; this field surfaces the preview only).
 *  - The existing image URL is kept until a replacement uploads AND succeeds.
 *  - "Remove" clears the image reference (sets imageUrl null); it does NOT
 *    delete the stored asset in this phase.
 *  - The existing image-URL paste option is preserved alongside upload.
 *  - Prevents duplicate uploads via a synchronous ref-backed lock.
 *
 * Presentation only. No server-only imports.
 */
import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Upload, X, RefreshCw, ImageIcon } from "lucide-react";
import { uploadMenuItemImage, getMenuImageUploadConfig } from "@/lib/image-upload.functions";
import {
  ACCEPTED_IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
  isValidImageFile,
  readFileBytes,
  encodeBase64,
  detectImageFormat,
  type UploadState,
} from "@/lib/menu/image-upload";

interface ImageUploadFieldProps {
  /** Current committed image URL (from the form values). */
  imageUrl: string;
  imageAlt: string;
  /** Item ID used to namespace the storage path server-side. For create, a
   *  throwaway ID is supplied so the path is still unique. */
  itemId: string;
  /** Called when an upload succeeds with the new public URL. */
  onUploaded: (url: string) => void;
  /** Called when the user removes the image. */
  onRemoved: () => void;
  /** Called when an upload starts and again when it ends (success or failure).
   *  Lets the parent block saving a stale URL while an upload is pending. */
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
}

export function ImageUploadField({
  imageUrl,
  imageAlt,
  itemId,
  onUploaded,
  onRemoved,
  onPendingChange,
  disabled,
}: ImageUploadFieldProps) {
  const uploadFn = useServerFn(uploadMenuItemImage);
  const configFn = useServerFn(getMenuImageUploadConfig);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Synchronous lock so two rapid selects cannot start two uploads.
  const busyLock = useRef(false);
  const [state, setState] = useState<UploadState>({
    status: "idle",
    url: null,
    error: null,
    fileName: null,
  });
  const [dataMode, setDataMode] = useState<"mock" | "supabase" | null>(null);

  // Fetch the data-mode label once for the development-only mock indicator.
  useState(() => {
    configFn()
      .then((c) => setDataMode(c.dataMode))
      .catch(() => setDataMode("supabase"));
  });

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const runUpload = useCallback(
    async (file: File) => {
      if (busyLock.current) return;
      // Client-side pre-check for fast feedback.
      const valid = isValidImageFile(file);
      if (!valid.ok) {
        setState({ status: "error", url: null, error: valid.reason, fileName: file.name });
        resetInput();
        return;
      }
      busyLock.current = true;
      onPendingChange?.(true);
      setState({ status: "uploading", url: null, error: null, fileName: file.name });
      try {
        const bytes = await readFileBytes(file);
        // Client-side magic-byte check for immediate feedback; server is
        // authoritative.
        const fmt = detectImageFormat(bytes);
        if (!fmt) {
          setState({
            status: "error",
            url: null,
            error: "That file is not a valid JPEG, PNG, or WebP image.",
            fileName: file.name,
          });
          resetInput();
          return;
        }
        const base64 = encodeBase64(bytes);
        const res = await uploadFn({
          data: { fileName: file.name, mediaType: fmt, base64, itemId },
        });
        if (res.ok) {
          setState({ status: "done", url: res.url, error: null, fileName: file.name });
          onUploaded(res.url);
        } else {
          setState({ status: "error", url: null, error: res.message, fileName: file.name });
        }
      } catch {
        setState({
          status: "error",
          url: null,
          error: "The image could not be uploaded. Please try again.",
          fileName: file.name,
        });
      } finally {
        busyLock.current = false;
        onPendingChange?.(false);
        resetInput();
      }
    },
    [uploadFn, itemId, onUploaded, onPendingChange],
  );

  const showPreview = imageUrl || state.url;
  const busy = state.status === "uploading" || disabled;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium leading-none">Menu photo</span>
        {dataMode === "mock" && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Mock upload (dev only)
          </span>
        )}
      </div>

      {/* Preview area */}
      {showPreview ? (
        <div className="relative overflow-hidden rounded-lg border border-border bg-card">
          <img
            src={(state.url ?? imageUrl)!}
            alt={imageAlt || "Selected menu photo preview"}
            className="aspect-[4/3] w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          {state.status === "uploading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-charcoal/40">
              <Loader2 className="size-6 animate-spin text-white" aria-hidden />
              <span className="sr-only">Uploading image…</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <div className="text-center text-muted-foreground">
            <ImageIcon className="mx-auto size-8" aria-hidden />
            <p className="mt-1.5 text-xs">No photo selected</p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id="item-image-file"
          type="file"
          accept={ACCEPTED_IMAGE_ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void runUpload(file);
          }}
        />
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Upload className="size-4" aria-hidden />
          {showPreview ? "Replace photo" : "Upload photo"}
        </button>
        {showPreview && (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setState({ status: "idle", url: null, error: null, fileName: null });
              onRemoved();
            }}
            disabled={busy}
          >
            <X className="size-4" aria-hidden />
            Remove
          </button>
        )}
        {state.status === "error" && (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <RefreshCw className="size-4" aria-hidden />
            Retry
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground" id="item-image-file-help">
        JPEG, PNG, or WebP. {Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB max. Descriptive alt
        text is required when a photo is added.
      </p>

      {state.status === "error" && state.error && (
        <p id="item-image-upload-error" className="text-xs text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
