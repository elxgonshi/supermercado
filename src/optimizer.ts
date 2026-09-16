import { STORE_IDS, type StoreId, type StoreProduct } from "./catalog.ts";
import {
  eligibleBaseUnitPrice,
  isValidBundlePromotion,
  type AvailabilityState,
  type BundlePromotion,
  type PriceObservation,
} from "./pricing.ts";

export interface BasketItem {
  id: string;
  canonicalProductId: string;
  /** Cantidad de unidades retail exactas requeridas. */
  quantity: number;
}

export interface PricedStoreProduct {
  storeProduct: StoreProduct;
  observation: PriceObservation;
}

export type AvailabilityPolicy = "require_available" | "allow_unknown";

export interface OptimizeOptions {
  /** Cadenas donde el usuario puede acceder a precio/promoción de socio. */
  memberStores?: readonly StoreId[];
  /** Por defecto UNKNOWN no se considera comprable. */
  availabilityPolicy?: AvailabilityPolicy;
  /** Límite matemático de cadenas del plan final. */
  maxStores?: number;
}

export interface OptimizedLine {
  basketItemId: string;
  canonicalProductId: string;
  quantity: number;
  store: StoreId;
  branchId: string | null;
  storeProductId: string;
  rawName: string;
  observedAt: string;
  availability: AvailabilityState;
  lineTotal: number;
  baseUnitPrice: number | null;
  pricingMode: "unit" | "bundle";
  bundleApplications: number;
  bundleRequiredQuantity: number | null;
  bundleTotalPrice: number | null;
  promotionSourceText: string | null;
  usesMembership: boolean;
  uncertainAvailability: boolean;
}

export interface StorePlanSegment {
  store: StoreId;
  branchId: string | null;
  items: OptimizedLine[];
  subtotal: number;
}

export interface BasketPlan {
  feasible: true;
  stores: StoreId[];
  storeCount: number;
  items: OptimizedLine[];
  byStore: StorePlanSegment[];
  total: number;
  uncertainAvailabilityItems: string[];
}

export interface InfeasibleStorePlan {
  feasible: false;
  stores: StoreId[];
  missingItemIds: string[];
}

export type StorePlanEvaluation = BasketPlan | InfeasibleStorePlan;

export interface StoreLimitResult {
  maxStores: number;
  plan: BasketPlan | null;
  /** Ahorro vs. el mejor plan con un supermercado menos. */
  marginalSaving: number | null;
}

export interface OptimizationResult {
  singleStorePlans: StorePlanEvaluation[];
  bestByStoreLimit: StoreLimitResult[];
  bestSingleStore: BasketPlan | null;
  bestTwoStores: BasketPlan | null;
  unrestricted: BasketPlan | null;
  optimalPlan: BasketPlan | null;
  unresolvedItemIds: string[];
}

interface LineCost {
  total: number;
  baseUnitPrice: number | null;
  pricingMode: "unit" | "bundle";
  bundleApplications: number;
  promotion: BundlePromotion | null;
  usesMembership: boolean;
}

function assertBasket(items: readonly BasketItem[]): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) throw new Error("Basket item id must not be empty");
    if (ids.has(item.id)) throw new Error(`Duplicate basket item id: ${item.id}`);
    ids.add(item.id);
    if (!item.canonicalProductId.trim()) {
      throw new Error(`Basket item ${item.id} requires canonicalProductId`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`Basket item ${item.id} quantity must be a positive integer`);
    }
  }
}

function assertOfferLink(offer: PricedStoreProduct): void {
  const { storeProduct, observation } = offer;
  if (!storeProduct.canonicalProductId) {
    throw new Error(`Store product ${storeProduct.storeProductId} is not linked to a canonical product`);
  }
  if (storeProduct.store !== observation.store) {
    throw new Error(`Store mismatch for ${storeProduct.storeProductId}`);
  }
  if (storeProduct.storeProductId !== observation.storeProductId) {
    throw new Error(`Store product id mismatch for ${storeProduct.storeProductId}`);
  }
  if (!Number.isFinite(Date.parse(observation.observedAt))) {
    throw new Error(`Invalid observedAt for ${storeProduct.store}:${storeProduct.storeProductId}`);
  }
}

function collapseToLatestOffers(offers: readonly PricedStoreProduct[]): PricedStoreProduct[] {
  const latest = new Map<string, PricedStoreProduct>();
  for (const offer of offers) {
    assertOfferLink(offer);
    const { storeProduct, observation } = offer;
    const key = `${storeProduct.store}\u0000${storeProduct.storeProductId}\u0000${observation.branchId ?? "<unknown>"}`;
    const current = latest.get(key);
    if (!current || Date.parse(observation.observedAt) > Date.parse(current.observation.observedAt)) {
      latest.set(key, offer);
    }
  }
  return [...latest.values()];
}

/** Prevents a basket from silently combining prices from two branches of one chain. */
function assertSingleBranchContextPerStore(offers: readonly PricedStoreProduct[]): void {
  const contexts = new Map<StoreId, Set<string>>();
  for (const offer of offers) {
    const set = contexts.get(offer.storeProduct.store) ?? new Set<string>();
    set.add(offer.observation.branchId ?? "<unknown>");
    contexts.set(offer.storeProduct.store, set);
  }
  for (const [store, branches] of contexts) {
    if (branches.size > 1) {
      throw new Error(
        `${store} offers contain multiple branch contexts (${[...branches].join(", ")}); preselect one branch before optimizing`,
      );
    }
  }
}

function offerAllowed(observation: PriceObservation, policy: AvailabilityPolicy): boolean {
  if (observation.availability === "UNAVAILABLE") return false;
  if (observation.availability === "UNKNOWN") return policy === "allow_unknown";
  return true;
}

function maxBundleApplications(
  promotion: BundlePromotion,
  quantity: number,
): number {
  const structuralMax = Math.floor(quantity / promotion.requiredQuantity);
  if (structuralMax <= 0) return 0;
  if (promotion.maxApplications !== null) {
    return Math.min(structuralMax, promotion.maxApplications);
  }
  return promotion.repeatability === "repeatable" ? structuralMax : 1;
}

function betterLineCost(candidate: LineCost, current: LineCost | null): boolean {
  if (!current) return true;
  if (candidate.total !== current.total) return candidate.total < current.total;
  // If totals tie, prefer the simpler non-bundle calculation.
  if (candidate.pricingMode !== current.pricingMode) return candidate.pricingMode === "unit";
  if (candidate.usesMembership !== current.usesMembership) return !candidate.usesMembership;
  return false;
}

export function priceLine(
  quantity: number,
  observation: PriceObservation,
  hasMembership: boolean,
): LineCost | null {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Line quantity must be a positive integer");
  }

  const base = eligibleBaseUnitPrice(observation, hasMembership);
  let best: LineCost | null = base
    ? {
        total: quantity * base.price,
        baseUnitPrice: base.price,
        pricingMode: "unit",
        bundleApplications: 0,
        promotion: null,
        usesMembership: base.usesMemberPrice,
      }
    : null;

  for (const promotion of observation.promotions) {
    if (promotion.kind !== "bundle" || !isValidBundlePromotion(promotion)) continue;
    if (promotion.memberOnly && !hasMembership) continue;

    const allowedApplications = maxBundleApplications(promotion, quantity);
    for (let applications = 1; applications <= allowedApplications; applications++) {
      const bundledUnits = applications * promotion.requiredQuantity;
      const remainingUnits = quantity - bundledUnits;
      if (remainingUnits > 0 && !base) continue;

      const total = applications * promotion.totalPrice + remainingUnits * (base?.price ?? 0);
      const candidate: LineCost = {
        total,
        baseUnitPrice: base?.price ?? null,
        pricingMode: "bundle",
        bundleApplications: applications,
        promotion,
        usesMembership: promotion.memberOnly || Boolean(base?.usesMemberPrice && remainingUnits > 0),
      };
      if (betterLineCost(candidate, best)) best = candidate;
    }
  }

  return best;
}

function lineFromOffer(
  item: BasketItem,
  offer: PricedStoreProduct,
  memberStores: ReadonlySet<StoreId>,
): OptimizedLine | null {
  const hasMembership = memberStores.has(offer.storeProduct.store);
  const cost = priceLine(item.quantity, offer.observation, hasMembership);
  if (!cost) return null;

  return {
    basketItemId: item.id,
    canonicalProductId: item.canonicalProductId,
    quantity: item.quantity,
    store: offer.storeProduct.store,
    branchId: offer.observation.branchId,
    storeProductId: offer.storeProduct.storeProductId,
    rawName: offer.storeProduct.rawName,
    observedAt: offer.observation.observedAt,
    availability: offer.observation.availability,
    lineTotal: cost.total,
    baseUnitPrice: cost.baseUnitPrice,
    pricingMode: cost.pricingMode,
    bundleApplications: cost.bundleApplications,
    bundleRequiredQuantity: cost.promotion?.requiredQuantity ?? null,
    bundleTotalPrice: cost.promotion?.totalPrice ?? null,
    promotionSourceText: cost.promotion?.sourceText ?? null,
    usesMembership: cost.usesMembership,
    uncertainAvailability: offer.observation.availability === "UNKNOWN",
  };
}

function compareLines(a: OptimizedLine, b: OptimizedLine): number {
  if (a.lineTotal !== b.lineTotal) return a.lineTotal - b.lineTotal;
  if (a.uncertainAvailability !== b.uncertainAvailability) return a.uncertainAvailability ? 1 : -1;
  if (a.usesMembership !== b.usesMembership) return a.usesMembership ? 1 : -1;
  const storeOrder = STORE_IDS.indexOf(a.store) - STORE_IDS.indexOf(b.store);
  if (storeOrder !== 0) return storeOrder;
  return a.storeProductId.localeCompare(b.storeProductId);
}

function evaluateStoreSubset(
  items: readonly BasketItem[],
  offers: readonly PricedStoreProduct[],
  stores: readonly StoreId[],
  memberStores: ReadonlySet<StoreId>,
  availabilityPolicy: AvailabilityPolicy,
): StorePlanEvaluation {
  const allowedStores = new Set(stores);
  const lines: OptimizedLine[] = [];
  const missingItemIds: string[] = [];

  for (const item of items) {
    const candidates = offers
      .filter(
        (offer) =>
          allowedStores.has(offer.storeProduct.store) &&
          offer.storeProduct.canonicalProductId === item.canonicalProductId &&
          offerAllowed(offer.observation, availabilityPolicy),
      )
      .map((offer) => lineFromOffer(item, offer, memberStores))
      .filter((line): line is OptimizedLine => line !== null)
      .sort(compareLines);

    const best = candidates[0];
    if (!best) {
      missingItemIds.push(item.id);
      continue;
    }
    lines.push(best);
  }

  if (missingItemIds.length > 0) {
    return { feasible: false, stores: [...stores], missingItemIds };
  }

  const usedStores = STORE_IDS.filter((store) => lines.some((line) => line.store === store));
  const byStore: StorePlanSegment[] = usedStores.map((store) => {
    const storeItems = lines.filter((line) => line.store === store);
    const branchId = storeItems[0]?.branchId ?? null;
    return {
      store,
      branchId,
      items: storeItems,
      subtotal: storeItems.reduce((sum, line) => sum + line.lineTotal, 0),
    };
  });

  return {
    feasible: true,
    stores: usedStores,
    storeCount: usedStores.length,
    items: lines,
    byStore,
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    uncertainAvailabilityItems: lines
      .filter((line) => line.uncertainAvailability)
      .map((line) => line.basketItemId),
  };
}

function enumerateStoreSubsets(stores: readonly StoreId[], maxSize: number): StoreId[][] {
  const result: StoreId[][] = [];
  const visit = (start: number, current: StoreId[]): void => {
    if (current.length > 0) result.push([...current]);
    if (current.length === maxSize) return;
    for (let i = start; i < stores.length; i++) {
      const store = stores[i];
      if (!store) continue;
      current.push(store);
      visit(i + 1, current);
      current.pop();
    }
  };
  visit(0, []);
  return result;
}

function comparePlans(a: BasketPlan, b: BasketPlan): number {
  if (a.total !== b.total) return a.total - b.total;
  if (a.storeCount !== b.storeCount) return a.storeCount - b.storeCount;
  if (a.uncertainAvailabilityItems.length !== b.uncertainAvailabilityItems.length) {
    return a.uncertainAvailabilityItems.length - b.uncertainAvailabilityItems.length;
  }
  return a.stores.join("|").localeCompare(b.stores.join("|"));
}

function bestFeasible(evaluations: readonly StorePlanEvaluation[]): BasketPlan | null {
  const feasible = evaluations.filter((plan): plan is BasketPlan => plan.feasible).sort(comparePlans);
  return feasible[0] ?? null;
}

export function optimizeBasket(
  items: readonly BasketItem[],
  rawOffers: readonly PricedStoreProduct[],
  options: OptimizeOptions = {},
): OptimizationResult {
  assertBasket(items);
  const offers = collapseToLatestOffers(rawOffers);
  assertSingleBranchContextPerStore(offers);

  const memberStores = new Set(options.memberStores ?? []);
  const availabilityPolicy = options.availabilityPolicy ?? "require_available";
  const activeStores = STORE_IDS.filter((store) => offers.some((offer) => offer.storeProduct.store === store));

  const singleStorePlans = activeStores.map((store) =>
    evaluateStoreSubset(items, offers, [store], memberStores, availabilityPolicy),
  );
  const bestSingleStore = bestFeasible(singleStorePlans);

  const subsets = enumerateStoreSubsets(activeStores, activeStores.length);
  const evaluations = subsets.map((stores) =>
    evaluateStoreSubset(items, offers, stores, memberStores, availabilityPolicy),
  );

  const bestByStoreLimit: StoreLimitResult[] = [];
  let previous: BasketPlan | null = null;
  for (let limit = 1; limit <= activeStores.length; limit++) {
    const plan = bestFeasible(
      evaluations.filter((evaluation) => evaluation.feasible && evaluation.storeCount <= limit),
    );
    const marginalSaving = previous && plan ? Math.max(0, previous.total - plan.total) : null;
    bestByStoreLimit.push({ maxStores: limit, plan, marginalSaving });
    previous = plan;
  }

  const unrestricted = bestByStoreLimit.at(-1)?.plan ?? null;
  const bestTwoStores = bestByStoreLimit.find((entry) => entry.maxStores === 2)?.plan ?? unrestricted;

  const requestedLimit = options.maxStores ?? activeStores.length;
  if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) {
    throw new Error("maxStores must be a positive integer");
  }
  const cappedLimit = Math.min(requestedLimit, activeStores.length);
  const optimalPlan = bestByStoreLimit.find((entry) => entry.maxStores === cappedLimit)?.plan ?? null;

  const globallyEligibleCanonicalIds = new Set(
    offers
      .filter((offer) => offerAllowed(offer.observation, availabilityPolicy))
      .filter((offer) => lineFromOffer(
        { id: "__probe__", canonicalProductId: offer.storeProduct.canonicalProductId ?? "", quantity: 1 },
        offer,
        memberStores,
      ) !== null)
      .map((offer) => offer.storeProduct.canonicalProductId),
  );

  const unresolvedItemIds = items
    .filter((item) => !globallyEligibleCanonicalIds.has(item.canonicalProductId))
    .map((item) => item.id);

  return {
    singleStorePlans,
    bestByStoreLimit,
    bestSingleStore,
    bestTwoStores,
    unrestricted,
    optimalPlan,
    unresolvedItemIds,
  };
}
