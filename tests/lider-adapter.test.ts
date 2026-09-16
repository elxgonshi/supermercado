import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveLiderEan13Candidate,
  LiderAdapter,
  mapLiderAvailability,
  parseLiderSearchPayload,
  type LiderBridgeSearchResult,
  type LiderSearchBridge,
} from "../src/adapters/lider.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", "lider-search-adapter-minimal.json"), "utf-8"),
) as unknown;

const metadata = {
  observedAt: "2026-09-16T02:33:21.099Z",
  source: "lider_browser_ssr:https://super.lider.cl/search",
} as const;

test("pure Lider parser normalizes current SSR products and opaque store context", () => {
  const parsed = parseLiderSearchPayload(fixture, metadata);
  assert.equal(parsed.snapshots.length, 5);
  assert.equal(parsed.diagnostics.candidateProductNodes, 5);
  assert.deepEqual(parsed.branch, {
    store: "lider",
    branchId: "lider:store:0000000094",
    scope: "SESSION_SCOPED",
    source: "lider_ssr:storeId",
  });
});

test("Lider current rollback maps public current/normal/unit prices without fabricating member price", () => {
  const parsed = parseLiderSearchPayload(fixture, metadata);
  const butter = parsed.snapshots.find((s) => s.product.storeProductId === "00780292020330");
  assert.ok(butter);
  assert.equal(butter.product.rawName, "Mantequilla Con sal, 250 g");
  assert.equal(butter.product.brand, "Colun");
  assert.equal(butter.product.quantity, 250);
  assert.equal(butter.product.unit, "g");
  assert.equal(butter.product.packageCount, 1);
  assert.equal(butter.product.gtin, null);
  assert.equal(butter.observation.currentPrice, 2990);
  assert.equal(butter.observation.normalPrice, 3290);
  assert.equal(butter.observation.unitPrice, 11960);
  assert.equal(butter.observation.memberPrice, null);
  assert.equal(butter.observation.availability, "AVAILABLE");
  assert.deepEqual(butter.identityCandidates, [{
    kind: "derived_gtin_candidate",
    value: "7802920203300",
    confidence: "candidate",
    source: "lider_ssr:usItemId_observed_convention",
  }]);
});

test("Lider COMBINA becomes an explicit conservative bundle promotion", () => {
  const parsed = parseLiderSearchPayload(fixture, metadata);
  const coke = parsed.snapshots.find((s) => s.product.storeProductId === "00780161000057");
  assert.ok(coke);
  assert.deepEqual(coke.observation.promotions, [{
    kind: "bundle",
    requiredQuantity: 2,
    totalPrice: 1950,
    memberOnly: false,
    repeatability: "unknown",
    maxApplications: null,
    sourceText: "Combina 2 x $1.950",
  }]);
});

test("Lider positive OOS controls map to UNAVAILABLE only when signals converge", () => {
  const parsed = parseLiderSearchPayload(fixture, metadata);
  const chicken = parsed.snapshots.find((s) => s.product.storeProductId === "00780961172061");
  assert.ok(chicken);
  assert.equal(chicken.observation.availability, "UNAVAILABLE");

  assert.equal(mapLiderAvailability({
    availabilityStatusDisplayValue: "In stock",
    isOutOfStock: false,
    canAddToCart: false,
    showAtc: true,
  }), "UNKNOWN");
});

test("variable-weight Lider products do not become fixed retail prices or derived GTIN candidates", () => {
  const parsed = parseLiderSearchPayload(fixture, metadata);
  const weighted = parsed.snapshots.find((s) => s.product.storeProductId === "00216365000000");
  assert.ok(weighted);
  assert.equal(weighted.observation.currentPrice, null);
  assert.equal(weighted.observation.normalPrice, null);
  assert.equal(weighted.observation.unitPrice, 4590);
  assert.equal(weighted.product.quantity, null);
  assert.equal(weighted.product.unit, null);
  assert.equal(weighted.product.packageCount, null);
  assert.deepEqual(weighted.identityCandidates, []);
  assert.equal(deriveLiderEan13Candidate("00216365000000"), null);
});

test("Lider pack without per-unit content does not fake single-item identity", () => {
  const parsed = parseLiderSearchPayload(fixture, metadata);
  const pack = parsed.snapshots.find((s) => s.product.storeProductId === "00780161035635");
  assert.ok(pack);
  assert.equal(pack.product.packageCount, 6);
  assert.equal(pack.product.quantity, null);
  assert.equal(pack.product.unit, null);
});

test("structural product fallback still parses a product when historical __typename disappears", () => {
  const parsed = parseLiderSearchPayload(fixture, metadata);
  assert.ok(parsed.snapshots.some((s) => s.product.storeProductId === "00780161035635"));
});

test("explicit valid GTIN wins over derived identity candidate", () => {
  const payload = {
    storeId: "94",
    product: {
      __typename: "Product",
      usItemId: "00780292020330",
      gtin: "7802920203300",
      name: "Mantequilla Con sal, 250 g",
      brand: "Colun",
      canonicalUrl: "/ip/mantequillas-y-margarinas/00780292020330",
      priceInfo: { linePrice: "$2.990" },
      availabilityStatusDisplayValue: "In stock",
      isOutOfStock: false,
      canAddToCart: true,
      showAtc: true
    }
  };
  const parsed = parseLiderSearchPayload(payload, metadata);
  assert.equal(parsed.snapshots[0]?.product.gtin, "07802920203300");
  assert.deepEqual(parsed.snapshots[0]?.identityCandidates, []);
});

test("ambiguous store IDs degrade branch context to UNKNOWN", () => {
  const payload = structuredClone(fixture) as Record<string, unknown>;
  (payload as { extra?: unknown }).extra = { storeId: "0000000095" };
  const parsed = parseLiderSearchPayload(payload, metadata);
  assert.equal(parsed.branch.branchId, null);
  assert.equal(parsed.branch.scope, "UNKNOWN");
});

class FakeBridge implements LiderSearchBridge {
  private index = 0;
  constructor(private readonly responses: LiderBridgeSearchResult[]) {}

  async search(_query: string): Promise<LiderBridgeSearchResult> {
    const response = this.responses[this.index++];
    if (!response) throw new Error("fake bridge exhausted");
    return response;
  }

  async healthCheck() {
    return { ok: true, message: "fake browser ready" };
  }
}

test("Lider adapter hydrates cache and serves price/promo/availability getters without extra searches", async () => {
  const adapter = new LiderAdapter(new FakeBridge([{ nextData: fixture, ...metadata }]));
  const results = await adapter.searchProducts("coca cola");
  assert.equal(results.length, 5);

  const product = await adapter.getProduct("00780161000057");
  assert.ok(product);
  assert.equal((await adapter.getPrices(["00780161000057"])).length, 1);
  assert.equal((await adapter.getPromotions(["00780161000057"])).get("00780161000057")?.length, 1);
  assert.equal((await adapter.getAvailability(["00780961172061"])).get("00780961172061"), "UNAVAILABLE");
  assert.equal((await adapter.resolveBranch()).branchId, "lider:store:0000000094");
  assert.equal((await adapter.healthCheck()).ok, true);
});

test("Lider adapter invalidates cache when browser store context changes", async () => {
  const secondPayload = structuredClone(fixture) as {
    props: { pageProps: { initialData: { contentLayout: { modules: Array<{ configs?: { ad?: { storeId?: string } } }> } } } };
  };
  const module = secondPayload.props.pageProps.initialData.contentLayout.modules[1];
  assert.ok(module?.configs?.ad);
  module.configs.ad.storeId = "0000000095";

  const adapter = new LiderAdapter(new FakeBridge([
    { nextData: fixture, ...metadata },
    { nextData: secondPayload, observedAt: "2026-09-16T03:00:00.000Z", source: metadata.source },
  ]));

  await adapter.searchProducts("mantequilla colun");
  assert.ok(await adapter.getProduct("00780292020330"));
  await adapter.searchProducts("coca cola");
  assert.equal((await adapter.resolveBranch()).branchId, "lider:store:0000000095");
  // Products present in the second payload are re-hydrated; stale-only data would be removed.
  assert.ok(await adapter.getProduct("00780292020330"));
});

test("derived EAN candidate rejects unsupported values and keeps known packaged evidence", () => {
  assert.equal(deriveLiderEan13Candidate("00780292020330"), "7802920203300");
  assert.equal(deriveLiderEan13Candidate("00780292077754"), "7802920777542");
  assert.equal(deriveLiderEan13Candidate("00000000000000"), null);
  assert.equal(deriveLiderEan13Candidate("not-an-id"), null);
});
