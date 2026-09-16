import {
  normalizeGtin,
  normalizeText,
  parsePackSize,
  type BaseUnit,
  type StoreProduct,
} from "../catalog.ts";
import type {
  AvailabilityState,
  BundlePromotion,
  PriceObservation,
  Promotion,
} from "../pricing.ts";
import type {
  AdapterHealth,
  BranchContext,
  IdentityCandidate,
  StoreAdapter,
  StoreProductSnapshot,
} from "./types.ts";

const LIDER_ORIGIN = "https://super.lider.cl";
const MAX_WALK_DEPTH = 24;
const MAX_WALK_NODES = 150_000;
type JsonRecord = Record<string, unknown>;

export interface LiderBridgeSearchResult {
  readonly nextData: unknown;
  readonly observedAt: string;
  readonly source: string;
}

export interface LiderBridgeHealth {
  readonly ok: boolean;
  readonly message: string;
}

export interface LiderSearchBridge {
  search(query: string): Promise<LiderBridgeSearchResult>;
  healthCheck?(): Promise<LiderBridgeHealth>;
}

export interface ParsedLiderSearch {
  readonly branch: BranchContext;
  readonly snapshots: readonly StoreProductSnapshot[];
  readonly diagnostics: {
    readonly visitedNodes: number;
    readonly candidateProductNodes: number;
    readonly normalizedProducts: number;
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function recordAt(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function gs1CheckDigit(payload: string): string | null {
  if (!/^\d+$/.test(payload)) return null;
  let sum = 0;
  for (let i = payload.length - 1, position = 1; i >= 0; i--, position++) {
    const digit = Number(payload[i]);
    if (!Number.isInteger(digit)) return null;
    sum += digit * (position % 2 === 1 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

/** Candidate evidence only; never assign this derivation directly to StoreProduct.gtin. */
export function deriveLiderEan13Candidate(usItemId: string | null | undefined): string | null {
  if (!usItemId || !/^00\d{12}$/.test(usItemId)) return null;
  const payload = usItemId.slice(2);
  if (/^0+$/.test(payload) || payload.startsWith("2")) return null;
  const checkDigit = gs1CheckDigit(payload);
  if (checkDigit === null) return null;
  const candidate = `${payload}${checkDigit}`;
  return normalizeGtin(candidate) ? candidate : null;
}

function explicitGtinCandidate(product: JsonRecord): string | null {
  const normalized = [product.gtin, product.ean, product.upc]
    .map(nonEmptyString)
    .filter((value): value is string => value !== null)
    .map(normalizeGtin)
    .filter((value): value is string => value !== null);
  const distinct = [...new Set(normalized)];
  return distinct.length === 1 ? distinct[0] ?? null : null;
}

function moneyValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const text = nonEmptyString(value);
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function isWeightBasedPrice(value: unknown): boolean {
  const text = nonEmptyString(value);
  return text ? /\/\s*kg\b|\bx\s*kg\b/i.test(text) : false;
}

function categoryFromUrl(canonicalUrl: string | null): string | null {
  const match = canonicalUrl?.match(/^\/ip\/([^/]+)\//i);
  return match?.[1] ? normalizeText(match[1].replace(/-/g, " ")) : null;
}

function liderPackIdentity(rawName: string): {
  quantity: number | null;
  unit: BaseUnit | null;
  packageCount: number | null;
} {
  const normalized = normalizeText(rawName);
  const parsed = parsePackSize(rawName);
  if (!/\bpack\b/.test(normalized)) {
    return {
      quantity: parsed?.quantity ?? null,
      unit: parsed?.unit ?? null,
      packageCount: parsed?.packageCount ?? null,
    };
  }

  const trailingUnits = normalized.match(/\b(\d+)\s+(?:un|u|unidad|unidades)$/);
  if (trailingUnits?.[1]) {
    const count = Number(trailingUnits[1]);
    return {
      quantity: null,
      unit: null,
      packageCount: Number.isInteger(count) && count > 1 ? count : null,
    };
  }

  const containerCount = normalized.match(
    /\bpack\s+(\d+)\s+(?:botella|botellas|lata|latas|unidad|unidades)\b/,
  );
  if (containerCount?.[1]) {
    const count = Number(containerCount[1]);
    return {
      quantity: parsed?.unit === "un" ? null : (parsed?.quantity ?? null),
      unit: parsed?.unit === "un" ? null : (parsed?.unit ?? null),
      packageCount: Number.isInteger(count) && count > 1 ? count : null,
    };
  }

  if (parsed && parsed.packageCount > 1) return parsed;
  return {
    quantity: parsed?.unit === "un" ? null : (parsed?.quantity ?? null),
    unit: parsed?.unit === "un" ? null : (parsed?.unit ?? null),
    packageCount: null,
  };
}

export function mapLiderAvailability(product: JsonRecord): AvailabilityState {
  const display = nonEmptyString(product.availabilityStatusDisplayValue)?.toLowerCase() ?? null;
  const out = typeof product.isOutOfStock === "boolean" ? product.isOutOfStock : null;
  const canAdd = typeof product.canAddToCart === "boolean" ? product.canAddToCart : null;
  const showAtc = typeof product.showAtc === "boolean" ? product.showAtc : null;

  if (display === "in stock" && out === false && canAdd === true && showAtc === true) {
    return "AVAILABLE";
  }
  if (display === "out of stock" && out === true && canAdd === false && showAtc === false) {
    return "UNAVAILABLE";
  }
  return "UNKNOWN";
}

function parseBundlePromotions(product: JsonRecord): readonly BundlePromotion[] {
  const badges = recordAt(product.badges);
  const flags = Array.isArray(badges?.flags) ? badges.flags : [];
  const result: BundlePromotion[] = [];
  const seen = new Set<string>();

  for (const raw of flags) {
    const flag = recordAt(raw);
    const key = flag ? nonEmptyString(flag.key) : null;
    const text = flag ? nonEmptyString(flag.text) : null;
    if (!text || key?.toUpperCase() !== "COMBINA") continue;
    const match = text.match(/combina\s+(\d+)\s*x\s*\$?\s*([\d.]+)/i);
    if (!match?.[1] || !match[2]) continue;
    const requiredQuantity = Number(match[1]);
    const totalPrice = moneyValue(match[2]);
    if (!Number.isInteger(requiredQuantity) || requiredQuantity <= 1 || totalPrice === null) continue;
    const fingerprint = `${requiredQuantity}|${totalPrice}|${text}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    result.push({
      kind: "bundle",
      requiredQuantity,
      totalPrice,
      memberOnly: false,
      repeatability: "unknown",
      maxApplications: null,
      applicationScope: "unknown",
      sourceText: text,
    });
  }
  return result;
}

function isStructuralProductCandidate(node: JsonRecord): boolean {
  return node.__typename === "Product" || (
    nonEmptyString(node.usItemId) !== null &&
    nonEmptyString(node.name) !== null &&
    isRecord(node.priceInfo)
  );
}

function collectProductNodes(root: unknown): { products: JsonRecord[]; visitedNodes: number } {
  const products: JsonRecord[] = [];
  const seenNodes = new WeakSet<object>();
  const seenProducts = new Set<string>();
  let visitedNodes = 0;

  function walk(node: unknown, depth: number): void {
    if (depth > MAX_WALK_DEPTH || visitedNodes >= MAX_WALK_NODES || node === null || typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    visitedNodes++;

    if (isRecord(node) && isStructuralProductCandidate(node)) {
      const key = nonEmptyString(node.usItemId)
        ?? nonEmptyString(node.id)
        ?? nonEmptyString(node.canonicalUrl)
        ?? nonEmptyString(node.name)
        ?? `anonymous-${products.length}`;
      if (!seenProducts.has(key)) {
        seenProducts.add(key);
        products.push(node);
      }
    }

    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
    } else {
      for (const value of Object.values(node)) walk(value, depth + 1);
    }
  }

  walk(root, 0);
  return { products, visitedNodes };
}

const SENSITIVE_CONTEXT_PATH = /address|postal|zip|latitude|longitude|geo|coordinate|location|customer|session|token|cookie|auth|email|phone/i;

function collectStoreIds(root: unknown): string[] {
  const values = new Set<string>();
  const seen = new WeakSet<object>();
  let visited = 0;

  function walk(node: unknown, path: string, depth: number): void {
    if (depth > 18 || visited >= 120_000 || node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    visited++;

    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`, depth + 1));
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (!SENSITIVE_CONTEXT_PATH.test(nextPath) && key === "storeId") {
        const id = nonEmptyString(value);
        if (id && /^[A-Za-z0-9_-]{1,40}$/.test(id)) values.add(id);
      }
      walk(value, nextPath, depth + 1);
    }
  }

  walk(root, "", 0);
  return [...values].sort();
}

function branchFromPayload(nextData: unknown): BranchContext {
  const ids = collectStoreIds(nextData);
  if (ids.length !== 1) {
    return {
      store: "lider",
      branchId: null,
      scope: "UNKNOWN",
      source: ids.length === 0 ? "lider_ssr:no_store_id" : "lider_ssr:ambiguous_store_id",
    };
  }
  return {
    store: "lider",
    branchId: `lider:store:${ids[0]}`,
    scope: "SESSION_SCOPED",
    source: "lider_ssr:storeId",
  };
}

function productUrl(canonicalUrl: string | null): string | null {
  if (!canonicalUrl) return null;
  if (/^https:\/\//i.test(canonicalUrl)) return canonicalUrl;
  return canonicalUrl.startsWith("/") ? `${LIDER_ORIGIN}${canonicalUrl}` : null;
}

function normalizeLiderProduct(
  raw: JsonRecord,
  branch: BranchContext,
  observedAt: string,
  source: string,
): StoreProductSnapshot | null {
  const storeProductId = nonEmptyString(raw.usItemId) ?? nonEmptyString(raw.id);
  const rawName = nonEmptyString(raw.name);
  if (!storeProductId || !rawName) return null;

  const canonicalUrl = nonEmptyString(raw.canonicalUrl);
  const pack = liderPackIdentity(rawName);
  const explicitGtin = explicitGtinCandidate(raw);
  const derived = explicitGtin ? null : deriveLiderEan13Candidate(nonEmptyString(raw.usItemId));
  const identityCandidates: IdentityCandidate[] = derived ? [{
    kind: "derived_gtin_candidate",
    value: derived,
    confidence: "candidate",
    source: "lider_ssr:usItemId_observed_convention",
  }] : [];

  const priceInfo = recordAt(raw.priceInfo);
  const weighted = isWeightBasedPrice(priceInfo?.linePrice);
  const linePrice = moneyValue(priceInfo?.linePrice);
  const wasPrice = moneyValue(priceInfo?.wasPrice);
  const currentPrice = weighted ? null : linePrice;
  const safeWasPrice = currentPrice !== null && wasPrice !== null && wasPrice >= currentPrice
    ? wasPrice
    : null;

  const product: StoreProduct = {
    store: "lider",
    storeProductId,
    sku: nonEmptyString(raw.skuId) ?? nonEmptyString(raw.sku) ?? nonEmptyString(raw.id),
    gtin: explicitGtin,
    rawName,
    brand: nonEmptyString(raw.brand),
    family: null,
    variant: null,
    quantity: weighted ? null : pack.quantity,
    unit: weighted ? null : pack.unit,
    packageCount: weighted ? null : pack.packageCount,
    category: categoryFromUrl(canonicalUrl),
    url: productUrl(canonicalUrl),
    imageUrl: null,
    canonicalProductId: null,
  };

  const observation: PriceObservation = {
    store: "lider",
    storeProductId,
    branchId: branch.branchId,
    observedAt,
    normalPrice: weighted ? null : (safeWasPrice ?? currentPrice),
    currentPrice,
    memberPrice: null,
    unitPrice: weighted ? linePrice : moneyValue(priceInfo?.unitPrice),
    availability: mapLiderAvailability(raw),
    promotions: parseBundlePromotions(raw),
    source,
  };

  return { product, observation, identityCandidates };
}

function assertObservedAt(value: string): void {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error("Lider bridge must provide a valid observedAt timestamp");
  }
}

export function parseLiderSearchPayload(
  nextData: unknown,
  metadata: { readonly observedAt: string; readonly source: string },
): ParsedLiderSearch {
  assertObservedAt(metadata.observedAt);
  const branch = branchFromPayload(nextData);
  const collected = collectProductNodes(nextData);
  const snapshots = collected.products
    .map((raw) => normalizeLiderProduct(raw, branch, metadata.observedAt, metadata.source))
    .filter((snapshot): snapshot is StoreProductSnapshot => snapshot !== null);
  return {
    branch,
    snapshots,
    diagnostics: {
      visitedNodes: collected.visitedNodes,
      candidateProductNodes: collected.products.length,
      normalizedProducts: snapshots.length,
    },
  };
}

function sameBranch(left: BranchContext | null, right: BranchContext): boolean {
  return (
    left !== null &&
    left.scope !== "UNKNOWN" &&
    right.scope !== "UNKNOWN" &&
    left.branchId !== null &&
    right.branchId !== null &&
    left.branchId === right.branchId &&
    left.scope === right.scope
  );
}

export class LiderAdapter implements StoreAdapter {
  readonly store = "lider" as const;
  private readonly bridge: LiderSearchBridge;
  private readonly cache = new Map<string, StoreProductSnapshot>();
  private branch: BranchContext | null = null;
  private lastSuccessfulSearchAt: string | null = null;

  constructor(bridge: LiderSearchBridge) {
    this.bridge = bridge;
  }

  async searchProducts(query: string): Promise<readonly StoreProductSnapshot[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Lider search query must not be empty");

    const bridgeResult = await this.bridge.search(normalizedQuery);
    const parsed = parseLiderSearchPayload(bridgeResult.nextData, {
      observedAt: bridgeResult.observedAt,
      source: bridgeResult.source,
    });

    if (this.branch !== null && !sameBranch(this.branch, parsed.branch)) this.cache.clear();
    this.branch = parsed.branch;
    this.lastSuccessfulSearchAt = bridgeResult.observedAt;
    for (const snapshot of parsed.snapshots) this.cache.set(snapshot.product.storeProductId, snapshot);
    return parsed.snapshots;
  }

  async getProduct(storeProductId: string): Promise<StoreProductSnapshot | null> {
    return this.cache.get(storeProductId) ?? null;
  }

  async getPrices(storeProductIds: readonly string[]): Promise<readonly PriceObservation[]> {
    return storeProductIds
      .map((id) => this.cache.get(id)?.observation ?? null)
      .filter((value): value is PriceObservation => value !== null);
  }

  async getPromotions(storeProductIds: readonly string[]): Promise<ReadonlyMap<string, readonly Promotion[]>> {
    const result = new Map<string, readonly Promotion[]>();
    for (const id of storeProductIds) {
      const snapshot = this.cache.get(id);
      if (snapshot) result.set(id, snapshot.observation.promotions);
    }
    return result;
  }

  async getAvailability(storeProductIds: readonly string[]): Promise<ReadonlyMap<string, AvailabilityState>> {
    const result = new Map<string, AvailabilityState>();
    for (const id of storeProductIds) {
      const snapshot = this.cache.get(id);
      if (snapshot) result.set(id, snapshot.observation.availability);
    }
    return result;
  }

  async resolveBranch(): Promise<BranchContext> {
    return this.branch ?? {
      store: "lider",
      branchId: null,
      scope: "UNKNOWN",
      source: "lider_adapter:no_successful_search_yet",
    };
  }

  async healthCheck(): Promise<AdapterHealth> {
    const checkedAt = new Date().toISOString();
    if (this.bridge.healthCheck) {
      const result = await this.bridge.healthCheck();
      return { store: "lider", ok: result.ok, checkedAt, message: result.message };
    }
    if (this.lastSuccessfulSearchAt) {
      return {
        store: "lider",
        ok: true,
        checkedAt,
        message: `last successful SSR search: ${this.lastSuccessfulSearchAt}`,
      };
    }
    return {
      store: "lider",
      ok: false,
      checkedAt,
      message: "no successful SSR search has been observed yet",
    };
  }
}
