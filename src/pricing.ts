import type { StoreId } from "./catalog.ts";

export type AvailabilityState = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

export type BundleRepeatability = "single" | "repeatable" | "unknown";
export type BundleApplicationScope = "same_product" | "qualifying_group" | "unknown";

export interface BundlePromotion {
  readonly kind: "bundle";
  /** Cantidad de unidades del producto retail necesarias para activar el bundle. */
  readonly requiredQuantity: number;
  /** Precio total del bundle en CLP. */
  readonly totalPrice: number;
  /** Si la promoción exige membresía/Club de la cadena. */
  readonly memberOnly: boolean;
  /**
   * `unknown` se interpreta conservadoramente como una sola aplicación.
   * Solo `repeatable` permite repetir el bundle automáticamente.
   */
  readonly repeatability: BundleRepeatability;
  /** Límite explícito observado; null si la fuente no informa uno. */
  readonly maxApplications: number | null;
  /**
   * Alcance de elegibilidad cuando la fuente lo expone. Si está presente y no
   * es `same_product`, el optimizador exact-product no puede aplicar el bundle
   * como descuento de múltiples unidades del mismo SKU.
   *
   * Se mantiene opcional para compatibilidad con contratos ya validados donde
   * la semántica same-product fue demostrada antes de introducir este campo.
   */
  readonly applicationScope?: BundleApplicationScope;
  readonly sourceText: string | null;
}

export type Promotion = BundlePromotion;

/**
 * Observación inmutable de precio. El historial debe agregar filas, no sobreescribirlas.
 */
export interface PriceObservation {
  readonly store: StoreId;
  readonly storeProductId: string;
  readonly branchId: string | null;
  readonly observedAt: string;
  readonly normalPrice: number | null;
  readonly currentPrice: number | null;
  readonly memberPrice: number | null;
  readonly unitPrice: number | null;
  readonly availability: AvailabilityState;
  readonly promotions: readonly Promotion[];
  readonly source: string;
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
  // A retailer may advertise a "mix & match" group. Never reinterpret that as
  // multiple units of this exact SKU unless same-product scope is proven.
  if (promotion.applicationScope !== undefined && promotion.applicationScope !== "same_product") {
    return false;
  }
  // Contradictory source data must not make a one-shot promotion repeatable.
  if (promotion.repeatability === "single" && (promotion.maxApplications ?? 1) !== 1) {
    return false;
  }
  return true;
}
