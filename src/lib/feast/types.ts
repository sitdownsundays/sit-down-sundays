/**
 * Feast offerings domain types & DTOs for the "Choose Your Feast" showcase.
 * Independent of the Menu CMS and future booking engine.
 */

export interface FeastOffering {
  id: string;
  name: string;
  slug: string;
  description: string;
  pricePerPersonCents: number | null;
  inclusions: string[];
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  isPublished: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export type FeastOfferingDTO = FeastOffering;

export interface CreateFeastOfferingInput {
  name: string;
  slug: string;
  description?: string;
  pricePerPersonCents?: number | null;
  inclusions?: string[];
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  isPublished?: boolean;
  displayOrder?: number;
}

export interface UpdateFeastOfferingInput {
  id: string;
  expectedUpdatedAt: string;
  name?: string;
  slug?: string;
  description?: string;
  pricePerPersonCents?: number | null;
  inclusions?: string[];
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  isPublished?: boolean;
  displayOrder?: number;
}

export interface FeastOfferingOperationResult {
  success: boolean;
  offering?: FeastOfferingDTO;
  error?: string;
  conflict?: boolean;
}
