import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", "lider-stock-context-summary-2026-09-16.json"), "utf-8"),
) as {
  totals: {
    queries: number;
    products: number;
    queriesWithNextData: number;
    queriesWithChallenge: number;
    inStock: number;
    outOfStock: number;
    canAddToCartFalse: number;
    showAtcFalse: number;
    displayInStock: number;
    displayOutOfStock: number;
  };
  storeContext: {
    candidateKey: string;
    observedValues: string[];
    sameAcrossAllThreeQueries: boolean;
    scope: string;
  };
  stockContract: {
    availablePattern: {
      availabilityStatusDisplayValue: string;
      isOutOfStock: boolean;
      canAddToCart: boolean;
      showAtc: boolean;
      fulfillmentType: string;
    };
    unavailablePattern: {
      availabilityStatusDisplayValue: string;
      isOutOfStock: boolean;
      canAddToCart: boolean;
      showAtc: boolean;
      fulfillmentType: string;
    };
    positiveOutOfStockControls: Array<{ usItemId: string; name: string; brand: string }>;
  };
};

test("Lider v2 completed the three focused stock/context searches without challenge", () => {
  assert.equal(fixture.totals.queries, 3);
  assert.equal(fixture.totals.products, 73);
  assert.equal(fixture.totals.queriesWithNextData, 3);
  assert.equal(fixture.totals.queriesWithChallenge, 0);
});

test("Lider v2 exposes a stable technical storeId in the selected browser session", () => {
  assert.equal(fixture.storeContext.candidateKey, "storeId");
  assert.deepEqual(fixture.storeContext.observedValues, ["0000000094"]);
  assert.equal(fixture.storeContext.sameAcrossAllThreeQueries, true);
  assert.match(fixture.storeContext.scope, /not independently compared/u);
});

test("Lider current stock signals provide internally consistent available and unavailable states", () => {
  assert.deepEqual(fixture.stockContract.availablePattern, {
    availabilityStatusDisplayValue: "In stock",
    isOutOfStock: false,
    canAddToCart: true,
    showAtc: true,
    fulfillmentType: "FC",
  });
  assert.deepEqual(fixture.stockContract.unavailablePattern, {
    availabilityStatusDisplayValue: "Out of stock",
    isOutOfStock: true,
    canAddToCart: false,
    showAtc: false,
    fulfillmentType: "FC",
  });

  assert.equal(fixture.totals.inStock, 69);
  assert.equal(fixture.totals.displayInStock, 69);
  assert.equal(fixture.totals.outOfStock, 4);
  assert.equal(fixture.totals.displayOutOfStock, 4);
  assert.equal(fixture.totals.canAddToCartFalse, 4);
  assert.equal(fixture.totals.showAtcFalse, 4);
});

test("Lider v2 includes multiple positive out-of-stock controls", () => {
  assert.equal(fixture.stockContract.positiveOutOfStockControls.length, 4);
  assert.ok(
    fixture.stockContract.positiveOutOfStockControls.some(
      (product) => product.usItemId === "00780961172061" && product.brand === "Super Pollo",
    ),
  );
});
