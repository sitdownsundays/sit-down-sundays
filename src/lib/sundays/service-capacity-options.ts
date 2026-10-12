/**
 * Capacity-resource options for a Sunday service's selected room.
 *
 * Framework-independent, client-safe. No server-only imports.
 */

export interface ServiceCapacityOption {
  /** null means use the resource mapped to the selected venue space. */
  capacityResourceId: string | null;
  mode: "default" | "whole";
  totalCapacity: number;
}

export type ServiceCapacityOptionsResult =
  { ok: true; options: ServiceCapacityOption[] } | { ok: false; error: string };
