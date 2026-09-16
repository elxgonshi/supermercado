import type { StoreId, StoreProduct } from "../catalog.ts";
import type { AvailabilityState, PriceObservation, Promotion } from "../pricing.ts";

export type BranchScope = "EXACT_BRANCH" | "SESSION_SCOPED" | "UNKNOWN";

export interface BranchContext {
  readonly store: StoreId;
  /** Technical branch/store identifier from the retailer, namespaced when useful. */
  readonly branchId: string | null;
  /** How strongly the adapter can bind this identifier to a physical branch. */
  readonly scope: BranchScope;
  readonly source: string;
}

export interface IdentityCandidate {
  readonly kind: "derived_gtin_candidate";
  readonly value: string;
  /** Candidate evidence must never be treated as a confirmed GTIN automatically. */
  readonly confidence: "candidate";
  readonly source: string;
}

export interface StoreProductSnapshot {
  readonly product: StoreProduct;
  readonly observation: PriceObservation;
  readonly identityCandidates: readonly IdentityCandidate[];
}

export interface AdapterHealth {
  readonly store: StoreId;
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly message: string;
}

/**
 * Common cache-first contract for all supermarket adapters.
 *
 * `searchProducts()` is allowed to hydrate all price/promotion/availability data
 * in one retailer request. The other getters may therefore be served entirely
 * from the adapter cache instead of triggering extra network/browser requests.
 */
export interface StoreAdapter {
  readonly store: StoreId;

  searchProducts(query: string): Promise<readonly StoreProductSnapshot[]>;
  getProduct(storeProductId: string): Promise<StoreProductSnapshot | null>;
  getPrices(storeProductIds: readonly string[]): Promise<readonly PriceObservation[]>;
  getPromotions(storeProductIds: readonly string[]): Promise<ReadonlyMap<string, readonly Promotion[]>>;
  getAvailability(storeProductIds: readonly string[]): Promise<ReadonlyMap<string, AvailabilityState>>;
  resolveBranch(): Promise<BranchContext>;
  healthCheck(): Promise<AdapterHealth>;
}
