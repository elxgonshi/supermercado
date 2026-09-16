import test from "node:test";
import assert from "node:assert/strict";
import type { StoreId, StoreProduct } from "../src/catalog.ts";
import { optimizeBasket, priceLine, type BasketItem, type PricedStoreProduct } from "../src/optimizer.ts";
import type { PriceObservation } from "../src/pricing.ts";

function storeProduct(
  store: StoreId,
  canonicalProductId: string,
  storeProductId: string,
  rawName = storeProductId,
): StoreProduct {
  return {
    store,
    storeProductId,
    sku: storeProductId,
    gtin: null,
    rawName,
    brand: null,
    family: null,
    variant: null,
    quantity: null,
    unit: null,
    packageCount: null,
    category: null,
    url: null,
    imageUrl: null,
    canonicalProductId,
  };
}

function observation(
  store: StoreId,
  storeProductId: string,
  overrides: Partial<PriceObservation> = {},
): PriceObservation {
  return {
    store,
    storeProductId,
    branchId: store === "jumbo" ? "jumboclj955" : `${store}-selected`,
    observedAt: "2026-09-16T00:00:00.000Z",
    normalPrice: 2000,
    currentPrice: 2000,
    memberPrice: null,
    unitPrice: null,
    availability: "AVAILABLE",
    promotions: [],
    source: "fixture",
    ...overrides,
  };
}

function offer(
  store: StoreId,
  canonicalProductId: string,
  storeProductId: string,
  overrides: Partial<PriceObservation> = {},
): PricedStoreProduct {
  return {
    storeProduct: storeProduct(store, canonicalProductId, storeProductId),
    observation: observation(store, storeProductId, overrides),
  };
}

const oneItem: BasketItem[] = [{ id: "milk", canonicalProductId: "milk-colun-1l", quantity: 1 }];

test("current public price is used before normal price", () => {
  const result = optimizeBasket(oneItem, [
    offer("jumbo", "milk-colun-1l", "j-milk", { normalPrice: 1800, currentPrice: 1800 }),
    offer("unimarc", "milk-colun-1l", "u-milk", { normalPrice: 2000, currentPrice: 1700 }),
  ]);

  assert.equal(result.unrestricted?.total, 1700);
  assert.equal(result.unrestricted?.items[0]?.store, "unimarc");
});

test("member price is never used without declared membership", () => {
  const offers = [
    offer("jumbo", "milk-colun-1l", "j-milk", { currentPrice: 1700 }),
    offer("unimarc", "milk-colun-1l", "u-milk", { currentPrice: 1900, memberPrice: 1500 }),
  ];

  const publicResult = optimizeBasket(oneItem, offers);
  assert.equal(publicResult.unrestricted?.items[0]?.store, "jumbo");
  assert.equal(publicResult.unrestricted?.total, 1700);

  const memberResult = optimizeBasket(oneItem, offers, { memberStores: ["unimarc"] });
  assert.equal(memberResult.unrestricted?.items[0]?.store, "unimarc");
  assert.equal(memberResult.unrestricted?.total, 1500);
  assert.equal(memberResult.unrestricted?.items[0]?.usesMembership, true);
});

test("Club quantity bundle is applied only when membership is eligible", () => {
  const obs = observation("unimarc", "u-coke", {
    normalPrice: 1690,
    currentPrice: 1690,
    promotions: [{
      kind: "bundle",
      requiredQuantity: 2,
      totalPrice: 2000,
      memberOnly: true,
      repeatability: "unknown",
      maxApplications: null,
      sourceText: "2 x $2.000 Club Unimarc",
    }],
  });

  assert.equal(priceLine(2, obs, false)?.total, 3380);
  const member = priceLine(2, obs, true);
  assert.equal(member?.total, 2000);
  assert.equal(member?.pricingMode, "bundle");
  assert.equal(member?.usesMembership, true);
});

test("unknown bundle repeatability is conservative: one application only", () => {
  const obs = observation("unimarc", "u-coke", {
    normalPrice: 1690,
    currentPrice: 1690,
    promotions: [{
      kind: "bundle",
      requiredQuantity: 2,
      totalPrice: 2000,
      memberOnly: true,
      repeatability: "unknown",
      maxApplications: null,
      sourceText: "2 x $2.000",
    }],
  });

  assert.equal(priceLine(4, obs, true)?.total, 5380);
  assert.equal(priceLine(4, obs, true)?.bundleApplications, 1);
});

test("explicitly repeatable bundle may be applied multiple times", () => {
  const obs = observation("unimarc", "u-coke", {
    normalPrice: 1690,
    currentPrice: 1690,
    promotions: [{
      kind: "bundle",
      requiredQuantity: 2,
      totalPrice: 2000,
      memberOnly: true,
      repeatability: "repeatable",
      maxApplications: null,
      sourceText: "2 x $2.000",
    }],
  });

  assert.equal(priceLine(4, obs, true)?.total, 4000);
  assert.equal(priceLine(4, obs, true)?.bundleApplications, 2);
});

test("overlapping web price and quantity bundle keep the cheaper valid combination", () => {
  const obs = observation("unimarc", "u-pack", {
    normalPrice: 5990,
    currentPrice: 4290,
    promotions: [{
      kind: "bundle",
      requiredQuantity: 2,
      totalPrice: 7200,
      memberOnly: true,
      repeatability: "unknown",
      maxApplications: null,
      sourceText: "2 x $7.200 Club Unimarc",
    }],
  });

  const priced = priceLine(3, obs, true);
  assert.equal(priced?.total, 11490);
  assert.equal(priced?.pricingMode, "bundle");
});

test("bundle-only pricing resolves the actual requested quantity", () => {
  const basket: BasketItem[] = [{ id: "promo", canonicalProductId: "promo-product", quantity: 2 }];
  const bundleOnly = offer("unimarc", "promo-product", "u-promo", {
    normalPrice: null,
    currentPrice: null,
    promotions: [{
      kind: "bundle",
      requiredQuantity: 2,
      totalPrice: 2000,
      memberOnly: false,
      repeatability: "unknown",
      maxApplications: null,
      sourceText: "2 x $2.000",
    }],
  });

  const result = optimizeBasket(basket, [bundleOnly]);
  assert.equal(result.unrestricted?.total, 2000);
  assert.deepEqual(result.unresolvedItemIds, []);
});

test("UNAVAILABLE offers are excluded", () => {
  const result = optimizeBasket(oneItem, [
    offer("jumbo", "milk-colun-1l", "j-milk", { currentPrice: 1900 }),
    offer("unimarc", "milk-colun-1l", "u-milk", { currentPrice: 1000, availability: "UNAVAILABLE" }),
  ]);
  assert.equal(result.unrestricted?.items[0]?.store, "jumbo");
});

test("UNKNOWN availability is excluded by default and can be allowed explicitly", () => {
  const offers = [
    offer("jumbo", "milk-colun-1l", "j-milk", { currentPrice: 1900 }),
    offer("unimarc", "milk-colun-1l", "u-milk", { currentPrice: 1000, availability: "UNKNOWN" }),
  ];

  assert.equal(optimizeBasket(oneItem, offers).unrestricted?.items[0]?.store, "jumbo");
  const relaxed = optimizeBasket(oneItem, offers, { availabilityPolicy: "allow_unknown" });
  assert.equal(relaxed.unrestricted?.items[0]?.store, "unimarc");
  assert.deepEqual(relaxed.unrestricted?.uncertainAvailabilityItems, ["milk"]);
});

test("optimizer uses only the latest observation for the same store product and branch", () => {
  const older = offer("jumbo", "milk-colun-1l", "j-milk", {
    currentPrice: 1000,
    observedAt: "2026-09-15T00:00:00.000Z",
  });
  const newer = offer("jumbo", "milk-colun-1l", "j-milk", {
    currentPrice: 1900,
    observedAt: "2026-09-16T00:00:00.000Z",
  });

  assert.equal(optimizeBasket(oneItem, [older, newer]).unrestricted?.total, 1900);
});

test("optimizer refuses to mix two branch contexts from the same chain", () => {
  const branchA = offer("jumbo", "milk-colun-1l", "j-milk-a", { branchId: "jumboclj955" });
  const branchB = offer("jumbo", "milk-colun-1l", "j-milk-b", { branchId: "jumboclj999" });
  assert.throws(
    () => optimizeBasket(oneItem, [branchA, branchB]),
    /multiple branch contexts/,
  );
});

test("no offers returns unresolved items instead of throwing", () => {
  const result = optimizeBasket(oneItem, []);
  assert.equal(result.unrestricted, null);
  assert.equal(result.optimalPlan, null);
  assert.deepEqual(result.unresolvedItemIds, ["milk"]);
  assert.deepEqual(result.bestByStoreLimit, []);
});

test("single-store and split plans expose marginal savings instead of assuming another store is worth it", () => {
  const basket: BasketItem[] = [
    { id: "milk", canonicalProductId: "milk", quantity: 1 },
    { id: "sugar", canonicalProductId: "sugar", quantity: 1 },
  ];
  const offers = [
    offer("jumbo", "milk", "j-milk", { currentPrice: 1000 }),
    offer("jumbo", "sugar", "j-sugar", { currentPrice: 2000 }),
    offer("unimarc", "milk", "u-milk", { currentPrice: 1500 }),
    offer("unimarc", "sugar", "u-sugar", { currentPrice: 1000 }),
  ];

  const result = optimizeBasket(basket, offers);
  assert.equal(result.bestSingleStore?.total, 2500);
  assert.equal(result.bestSingleStore?.stores[0], "unimarc");
  assert.equal(result.bestTwoStores?.total, 2000);
  assert.equal(result.bestTwoStores?.storeCount, 2);
  assert.equal(result.bestByStoreLimit[1]?.marginalSaving, 500);
});

test("if splitting saves nothing, store-limit marginal saving is zero and one store wins ties", () => {
  const basket: BasketItem[] = [
    { id: "milk", canonicalProductId: "milk", quantity: 1 },
    { id: "sugar", canonicalProductId: "sugar", quantity: 1 },
  ];
  const offers = [
    offer("jumbo", "milk", "j-milk", { currentPrice: 1000 }),
    offer("jumbo", "sugar", "j-sugar", { currentPrice: 1000 }),
    offer("unimarc", "milk", "u-milk", { currentPrice: 1000 }),
    offer("unimarc", "sugar", "u-sugar", { currentPrice: 1000 }),
  ];

  const result = optimizeBasket(basket, offers);
  assert.equal(result.bestSingleStore?.total, 2000);
  assert.equal(result.bestTwoStores?.total, 2000);
  assert.equal(result.bestTwoStores?.storeCount, 1);
  assert.equal(result.bestByStoreLimit[1]?.marginalSaving, 0);
});

test("optimizer v1 rejects Lider offers until that adapter is validated", () => {
  const liderOffer = offer("lider", "milk-colun-1l", "l-milk", { currentPrice: 1000 });
  assert.throws(
    () => optimizeBasket(oneItem, [liderOffer]),
    /lider is not supported by optimizer v1/,
  );
});

test("maxStores selects the mathematical optimum under the requested constraint", () => {
  const basket: BasketItem[] = [
    { id: "milk", canonicalProductId: "milk", quantity: 1 },
    { id: "sugar", canonicalProductId: "sugar", quantity: 1 },
  ];
  const offers = [
    offer("jumbo", "milk", "j-milk", { currentPrice: 1000 }),
    offer("jumbo", "sugar", "j-sugar", { currentPrice: 2000 }),
    offer("unimarc", "milk", "u-milk", { currentPrice: 1500 }),
    offer("unimarc", "sugar", "u-sugar", { currentPrice: 1000 }),
  ];

  assert.equal(optimizeBasket(basket, offers, { maxStores: 1 }).optimalPlan?.total, 2500);
  assert.equal(optimizeBasket(basket, offers, { maxStores: 2 }).optimalPlan?.total, 2000);
});

test("empty baskets and invalid maxStores are rejected", () => {
  assert.throws(() => optimizeBasket([], []), /at least one item/);
  assert.throws(() => optimizeBasket(oneItem, [], { maxStores: 0 }), /positive integer/);
});

test("exact-product optimizer does not use offers lacking a canonical link", () => {
  const bad = offer("jumbo", "milk-colun-1l", "j-milk");
  bad.storeProduct.canonicalProductId = null;
  assert.throws(() => optimizeBasket(oneItem, [bad]), /not linked to a canonical product/);
});
