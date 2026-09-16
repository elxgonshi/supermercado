import type { StoreId } from "./catalog.ts";

export type AvailabilityState = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

export type BundleRepeatability = "single" | "repeatable" | "unknown";

export interface BundlePromotion {
  kind: "bundle";
  /** Cantidad de unidades del producto retail necesarias para activar el bundle. */
  requiredQuantity: number;
  /** Precio total del bundle en CLP. */
  totalPrice: number;
  /** Si la promoción exige membresía/Club de la cadena. */
  memberOnly: boolean;
  /**
   * `unknown` se interpreta conservadoramente como una sola aplicación.
   * Solo `repeatable` permite repetir el bundle automáticamente.
   */
  repeatability: BundleRepeatability;
  /** Límite explícito observado; null si la fuente no informa uno. */
  maxApplications: number | null;
  sourceText: string | null;
}

export type Promotion = BundlePromotion;

/**
 * Observación inmutable de precio. El historial debe agregar filas, no sobreescribirlas.
 */
export interface PriceObservation {
  store: StoreId;
  storeProductId: string;
  branchId: string | null;
  observedAt: string;
  normalPrice: number | null;
  currentPrice: number | null;
  memberPrice: number | null;
  unitPrice: number | null;
  availability: AvailabilityState;
  promotions: Promotion[];
  source: string;
}

export function publicUnitPrice(observation: PriceObservation): number | null {
  return validPositivePrice(observation.currentPrice) ?? validPositivePrice(observation.normalPrice);
}

export function eligibleBaseUnitPrice(
  observation: PriceObservation,
  hasMembership: boolean,
): { price: number; usesMemberPrice: boolean } | null {
  const publicPrice = publicUnitPrice(observation);
  const memberPrice = hasMembership ? validPositivePrice(observation.memberPrice) : null;

  if (publicPrice === null && memberPrice === null) return null;
  if (memberPrice !== null && (publicPrice === null || memberPrice < publicPrice)) {
    return { price: memberPrice, usesMemberPrice: true };
  }
  return publicPrice === null ? null : { price: publicPrice, usesMemberPrice: false };
}

export function validPositivePrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function isValidBundlePromotion(promotion: BundlePromotion): boolean {
  if (!Number.isInteger(promotion.requiredQuantity) || promotion.requiredQuantity <= 1) return false;
  if (!Number.isFinite(promotion.totalPrice) || promotion.totalPrice <= 0) return false;
  if (
    promotion.maxApplications !== null &&
    (!Number.isInteger(promotion.maxApplications) || promotion.maxApplications <= 0)
  ) {
    return false;
  }
  return true;
}
