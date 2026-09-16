import test from "node:test";
import assert from "node:assert/strict";
import type { PriceObservation } from "../src/pricing.ts";

const observation: PriceObservation = {
  store: "unimarc",
  storeProductId: "410",
  branchId: "unimarc-selected",
  observedAt: "2026-09-16T00:00:00.000Z",
  normalPrice: 3390,
  currentPrice: 3390,
  memberPrice: 3050,
  unitPrice: null,
  availability: "AVAILABLE",
  promotions: [],
  source: "fixture",
};

if (false) {
  // These expectations make immutability part of the static contract checked by `tsc`.
  // @ts-expect-error Price observations are append-only facts, not mutable state.
  observation.currentPrice = 1;
  // @ts-expect-error Promotion history must not be mutated in place.
  observation.promotions.push({
    kind: "bundle",
    requiredQuantity: 2,
    totalPrice: 2000,
    memberOnly: true,
    repeatability: "unknown",
    maxApplications: null,
    sourceText: null,
  });
}

test("price observation remains readable as an immutable value", () => {
  assert.equal(observation.currentPrice, 3390);
  assert.equal(observation.promotions.length, 0);
});
