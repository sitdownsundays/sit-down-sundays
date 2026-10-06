import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/layout/page-header";
import { CurrencyDisplay } from "@/components/layout/currency-display";
import { LoadingState } from "@/components/layout/loading-state";
import { ErrorState } from "@/components/layout/error-state";
import { EmptyState } from "@/components/layout/empty-state";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import {
  listAllFeastOfferings,
  createFeastOffering,
  updateFeastOffering,
  setFeastOfferingPublished,
} from "@/lib/feast.functions";
import type { FeastOfferingDTO } from "@/lib/feast/types";
import {
  Utensils,
  CheckCircle2,
  Eye,
  EyeOff,
  Edit,
  Plus,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";

/** Generate a stable throwaway UUID for the storage namespace of a new offering. */
function newNamespaceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0");
}

export function AdminFeastOfferingsPage() {
  const [offerings, setOfferings] = React.useState<FeastOfferingDTO[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editingOffering, setEditingOffering] = React.useState<FeastOfferingDTO | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const fetchAllFn = useServerFn(listAllFeastOfferings);
  const createFn = useServerFn(createFeastOffering);
  const updateFn = useServerFn(updateFeastOffering);
  const setPublishedFn = useServerFn(setFeastOfferingPublished);

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAllFn();
      setOfferings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load feast offerings");
    } finally {
      setLoading(false);
    }
  }, [fetchAllFn]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTogglePublish = async (offering: FeastOfferingDTO) => {
    try {
      setActionError(null);
      setSuccessMessage(null);
      const res = await setPublishedFn({
        data: {
          id: offering.id,
          isPublished: !offering.isPublished,
          expectedUpdatedAt: offering.updatedAt,
        },
      });

      if (!res.success) {
        setActionError(res.error || "Failed to update publication status");
        if (res.conflict) {
          loadData();
        }
        return;
      }

      setSuccessMessage(
        `${offering.name} is now ${!offering.isPublished ? "published" : "hidden (draft)"}.`,
      );
      loadData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    }
  };

  const handleSaveForm = async (formData: {
    name: string;
    slug: string;
    description: string;
    priceDollars: string;
    inclusionsText: string;
    coverImageUrl: string;
    coverImageAlt: string;
    isPublished: boolean;
    displayOrder: number;
  }) => {
    try {
      setSaving(true);
      setActionError(null);
      setSuccessMessage(null);

      // parse price dollars to cents
      let pricePerPersonCents: number | null = null;
      if (formData.priceDollars.trim().length > 0) {
        const parsed = parseFloat(formData.priceDollars);
        if (isNaN(parsed) || parsed < 0) {
          setActionError("Please enter a valid non-negative price");
          setSaving(false);
          return;
        }
        pricePerPersonCents = Math.round(parsed * 100);
      }

      // parse inclusions by line
      const inclusions = formData.inclusionsText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (editingOffering) {
        // Update
        const res = await updateFn({
          data: {
            id: editingOffering.id,
            expectedUpdatedAt: editingOffering.updatedAt,
            name: formData.name,
            slug: formData.slug,
            description: formData.description,
            pricePerPersonCents,
            inclusions,
            coverImageUrl: formData.coverImageUrl.trim() || null,
            coverImageAlt: formData.coverImageAlt.trim() || null,
            isPublished: formData.isPublished,
            displayOrder: formData.displayOrder,
          },
        });

        if (!res.success) {
          setActionError(res.error || "Failed to update offering");
          if (res.conflict) {
            loadData();
          }
          setSaving(false);
          return;
        }

        setSuccessMessage(`Updated "${formData.name}" successfully.`);
      } else {
        // Create
        const res = await createFn({
          data: {
            name: formData.name,
            slug: formData.slug,
            description: formData.description,
            pricePerPersonCents,
            inclusions,
            coverImageUrl: formData.coverImageUrl.trim() || null,
            coverImageAlt: formData.coverImageAlt.trim() || null,
            isPublished: formData.isPublished,
            displayOrder: formData.displayOrder,
          },
        });

        if (!res.success) {
          setActionError(res.error || "Failed to create offering");
          setSaving(false);
          return;
        }

        setSuccessMessage(`Created "${formData.name}" successfully.`);
      }

      setEditingOffering(null);
      setIsCreating(false);
      loadData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/admin" className="hover:text-foreground">
              Admin
            </Link>
            <span>/</span>
            <span>Feast Offerings</span>
          </div>
          <PageHeader
            eyebrow="Curated Dining"
            title="Choose Your Feast Offerings"
            description="Manage the display-only showcase feast offerings (Basic, Signature, Premium) shown on the public site."
          />
        </div>
        {!isCreating && !editingOffering && (
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setSuccessMessage(null);
              setIsCreating(true);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" />
            Add Feast Offering
          </button>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="size-5 shrink-0" />
          <p>{actionError}</p>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200"
        >
          <CheckCircle2 className="size-5 shrink-0" />
          <p>{successMessage}</p>
        </div>
      )}

      {/* Form modal/inline editor */}
      {(isCreating || editingOffering) && (
        <FeastOfferingForm
          initialData={editingOffering}
          saving={saving}
          onSave={handleSaveForm}
          onCancel={() => {
            setEditingOffering(null);
            setIsCreating(false);
            setActionError(null);
          }}
        />
      )}

      {/* Main listing */}
      {loading ? (
        <LoadingState label="Loading feast offerings..." />
      ) : error ? (
        <ErrorState
          title="Couldn't load feast offerings"
          message={error}
          action={
            <button
              type="button"
              onClick={() => loadData()}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
          }
        />
      ) : offerings.length === 0 ? (
        <EmptyState
          icon={<Utensils className="size-8" />}
          title="No feast offerings yet"
          description="Create your first feast offering or seed the standard Basic, Signature, and Premium meals."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {offerings.map((offering) => (
            <div
              key={offering.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/40"
            >
              {offering.coverImageUrl ? (
                <div className="relative aspect-4/3 w-full overflow-hidden bg-muted">
                  <img
                    src={offering.coverImageUrl}
                    alt={offering.coverImageAlt || offering.name}
                    className="h-full w-full object-cover"
                  />
                  <span
                    className={`absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      offering.isPublished
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-muted-foreground/80 text-white shadow-xs"
                    }`}
                  >
                    {offering.isPublished ? "Published" : "Draft"}
                  </span>
                </div>
              ) : (
                <div className="flex aspect-4/3 w-full items-center justify-center bg-muted/60 text-muted-foreground">
                  <span>No cover photo</span>
                </div>
              )}

              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-xl font-bold text-foreground">
                      {offering.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">Slug: {offering.slug}</p>
                  </div>
                  {offering.pricePerPersonCents !== null && (
                    <div className="text-right">
                      <span className="font-display text-lg font-bold text-primary">
                        <CurrencyDisplay cents={offering.pricePerPersonCents} />
                      </span>
                      <span className="block text-xs text-muted-foreground">/ person</span>
                    </div>
                  )}
                </div>

                {offering.description && (
                  <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                    {offering.description}
                  </p>
                )}

                {offering.inclusions.length > 0 && (
                  <div className="mt-4 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Inclusions
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-foreground/80">
                      {offering.inclusions.map((inc, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-primary">•</span>
                          <span>{inc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                  <span className="text-xs text-muted-foreground">
                    Order: {offering.displayOrder}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleTogglePublish(offering)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                      title={offering.isPublished ? "Unpublish" : "Publish"}
                    >
                      {offering.isPublished ? (
                        <>
                          <EyeOff className="size-3.5" /> Hide
                        </>
                      ) : (
                        <>
                          <Eye className="size-3.5" /> Publish
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setSuccessMessage(null);
                        setEditingOffering(offering);
                        setIsCreating(false);
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/80"
                    >
                      <Edit className="size-3.5" /> Edit
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface FeastOfferingFormProps {
  initialData: FeastOfferingDTO | null;
  saving: boolean;
  onSave: (data: {
    name: string;
    slug: string;
    description: string;
    priceDollars: string;
    inclusionsText: string;
    coverImageUrl: string;
    coverImageAlt: string;
    isPublished: boolean;
    displayOrder: number;
  }) => Promise<void>;
  onCancel: () => void;
}

function FeastOfferingForm({ initialData, saving, onSave, onCancel }: FeastOfferingFormProps) {
  const [name, setName] = React.useState(initialData?.name ?? "");
  const [slug, setSlug] = React.useState(initialData?.slug ?? "");
  const [description, setDescription] = React.useState(initialData?.description ?? "");
  const [priceDollars, setPriceDollars] = React.useState(
    initialData?.pricePerPersonCents != null
      ? (initialData.pricePerPersonCents / 100).toFixed(2)
      : "",
  );
  const [inclusionsText, setInclusionsText] = React.useState(
    initialData?.inclusions ? initialData.inclusions.join("\n") : "",
  );
  const [coverImageUrl, setCoverImageUrl] = React.useState(initialData?.coverImageUrl ?? "");
  const [coverImageAlt, setCoverImageAlt] = React.useState(initialData?.coverImageAlt ?? "");
  const [isPublished, setIsPublished] = React.useState(initialData?.isPublished ?? false);
  const [displayOrder, setDisplayOrder] = React.useState(initialData?.displayOrder ?? 0);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  // Track whether an upload is in progress so we can block saving a stale URL.
  const [uploading, setUploading] = React.useState(false);
  // Stable storage namespace: the existing offering id on edit, or a throwaway
  // UUID generated once per create session (not on every render).
  const namespaceIdRef = React.useRef<string>(initialData?.id ?? newNamespaceId());

  const handleAutoSlug = (newName: string) => {
    setName(newName);
    if (!initialData) {
      // auto slug
      const generated = newName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      setSlug(generated);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return; // do not save a stale/missing URL mid-upload
    const newErrors: Record<string, string> = {};

    if (!name.trim()) newErrors.name = "Name is required";
    if (!slug.trim()) newErrors.slug = "Slug is required";
    if (coverImageUrl.trim() && !coverImageAlt.trim()) {
      newErrors.coverImageAlt = "Accessible alt text is required when a cover image is provided";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave({
      name,
      slug,
      description,
      priceDollars,
      inclusionsText,
      coverImageUrl,
      coverImageAlt,
      isPublished,
      displayOrder,
    });
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-6 shadow-md">
      <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">
            {initialData ? `Edit "${initialData.name}"` : "Create Feast Offering"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Display-only feast showcase card shown on the public website.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <ArrowLeft className="size-3.5" /> Back to list
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Name */}
          <div>
            <label htmlFor="offering-name" className="block text-sm font-semibold text-foreground">
              Name *
            </label>
            <input
              id="offering-name"
              type="text"
              value={name}
              onChange={(e) => handleAutoSlug(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="e.g. Basic Meal"
            />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
          </div>

          {/* Slug */}
          <div>
            <label htmlFor="offering-slug" className="block text-sm font-semibold text-foreground">
              Slug (URL key) *
            </label>
            <input
              id="offering-slug"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="e.g. basic-meal"
            />
            {errors.slug && <p className="mt-1 text-xs text-destructive">{errors.slug}</p>}
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="offering-desc" className="block text-sm font-semibold text-foreground">
            Description
          </label>
          <textarea
            id="offering-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="A brief introduction to this feast experience..."
          />
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Price per person */}
          <div>
            <label htmlFor="offering-price" className="block text-sm font-semibold text-foreground">
              Price per person (USD)
            </label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-2 text-sm text-muted-foreground">$</span>
              <input
                id="offering-price"
                type="text"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                className="w-full rounded-md border border-input bg-background py-2 pl-7 pr-3 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="29.50"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Showcase display price only. Leave blank if unpriced.
            </p>
          </div>

          {/* Display Order */}
          <div>
            <label htmlFor="offering-order" className="block text-sm font-semibold text-foreground">
              Display Order
            </label>
            <input
              id="offering-order"
              type="number"
              min={0}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 0)}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              1 for Basic, 2 for Signature, 3 for Premium.
            </p>
          </div>
        </div>

        {/* Inclusions */}
        <div>
          <label
            htmlFor="offering-inclusions"
            className="block text-sm font-semibold text-foreground"
          >
            Inclusions (One per line)
          </label>
          <textarea
            id="offering-inclusions"
            rows={4}
            value={inclusionsText}
            onChange={(e) => setInclusionsText(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Choice of 2 meats&#10;Choice of 2 sides&#10;Fresh rolls or cornbread&#10;Soft drink or tea included"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Display-only marketing bullet points.
          </p>
        </div>

        {/* Image Upload + Alt */}
        <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
          <h3 className="text-sm font-semibold text-foreground">Cover Photograph</h3>
          <ImageUploadField
            imageUrl={coverImageUrl}
            imageAlt={coverImageAlt}
            itemId={namespaceIdRef.current}
            onUploaded={(url) => setCoverImageUrl(url)}
            onRemoved={() => setCoverImageUrl("")}
            onPendingChange={setUploading}
            disabled={saving}
          />

          <div>
            <label htmlFor="cover-alt" className="block text-sm font-semibold text-foreground">
              Accessible Alt Text {coverImageUrl ? "*" : "(optional)"}
            </label>
            <input
              id="cover-alt"
              type="text"
              value={coverImageAlt}
              onChange={(e) => setCoverImageAlt(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="e.g. Golden fried chicken and fried shrimp served on a warm platter"
            />
            {errors.coverImageAlt && (
              <p className="mt-1 text-xs text-destructive">{errors.coverImageAlt}</p>
            )}
          </div>
          {uploading && (
            <p className="text-xs text-muted-foreground" role="status">
              Upload in progress — saving is disabled until it completes.
            </p>
          )}
        </div>

        {/* Publish checkbox */}
        <div className="flex items-center gap-2">
          <input
            id="offering-published"
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="size-4 rounded border-input text-primary focus:ring-ring"
          />
          <label htmlFor="offering-published" className="text-sm font-medium text-foreground">
            Publish on website immediately
          </label>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {saving ? "Saving..." : initialData ? "Save Changes" : "Create Offering"}
          </button>
        </div>
      </form>
    </div>
  );
}
