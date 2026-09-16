import test from "node:test";
import assert from "node:assert/strict";
import { isValidBundlePromotion, type PriceObservation } from "../src/pricing.ts";
import { priceLine } from "../src/optimizer.ts";

test("contradictory single-use bundle with maxApplications > 1 is invalid", () => {
  const promotion = {
    kind: "bundle" as const,
    requiredQuantity: 2,
    totalPrice: 2000,
    memberOnly: false,
    repeatability: "single" as const,
    maxApplications: 3,
    sourceText: "2 x $2.000",
  };

  assert.equal(isValidBundlePromotion(promotion), false);

  const observation: PriceObservation = {
    store: "unimarc",
    storeProductId: "fixture",
    branchId: "unimarc-selected",
    observedAt: "2026-09-16T00:00:00.000Z",
    normalPrice: 1690,
    currentPrice: 1690,
    memberPrice: null,
    unitPrice: null,
    availability: "AVAILABLE",
    promotions: [promotion],
    source: "fixture",
  };

  assert.equal(priceLine(4, observation, false)?.total, 6760);
});
