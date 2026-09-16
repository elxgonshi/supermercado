import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", "lider-live-contract-summary-2026-09-16.json"), "utf-8"),
) as {
  queryCounts: Record<string, number>;
  totals: Record<string, number>;
  observedUsItemIdConvention: {
    allAre14DigitsStarting00: boolean;
    representativeCrossValidatedProducts: Array<{
      label: string;
      usItemId: string;
      derivedEan13: string;
      linePrice: number;
      wasPrice: number | null;
      availabilityStatus: string | null;
      promoFlags: Array<{ key: string; text: string; type: string }>;
    }>;
  };
};

function gs1CheckDigit(payload: string): string {
  let sum = 0;
  for (let i = payload.length - 1, position = 1; i >= 0; i--, position++) {
    const digit = Number(payload[i]);
    sum += digit * (position % 2 === 1 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

function deriveObservedLiderEan13Candidate(usItemId: string): string | null {
  if (!/^00\d{12}$/.test(usItemId)) return null;
  const payload = usItemId.slice(2);
  if (/^0+$/.test(payload)) return null;
  return `${payload}${gs1CheckDigit(payload)}`;
}

test("2026-09-16 live Lider probe completed all ten pilot queries without challenge", () => {
  assert.equal(Object.keys(fixture.queryCounts).length, 10);
  assert.equal(fixture.totals.queries, 10);
  assert.equal(fixture.totals.products, 301);
  assert.equal(fixture.totals.queriesWithNextData, 10);
  assert.equal(fixture.totals.queriesWithChallenge, 0);
});

test("live search exposes no explicit EAN UPC or GTIN field", () => {
  assert.equal(fixture.totals.productsWithExplicitEanUpcGtin, 0);
  assert.equal(fixture.totals.productsWithUsItemId, 301);
});

test("observed Lider usItemId convention reconstructs cross-validated EAN-13 candidates", () => {
  assert.equal(fixture.observedUsItemIdConvention.allAre14DigitsStarting00, true);
  assert.ok(fixture.observedUsItemIdConvention.representativeCrossValidatedProducts.length >= 6);

  for (const product of fixture.observedUsItemIdConvention.representativeCrossValidatedProducts) {
    assert.equal(
      deriveObservedLiderEan13Candidate(product.usItemId),
      product.derivedEan13,
      product.label,
    );
  }
});

test("candidate EAN derivation rejects Lider IDs outside the observed convention", () => {
  for (const value of ["", "7802920203300", "01780292020330", "00ABC292020330", "00000000000000"]) {
    assert.equal(deriveObservedLiderEan13Candidate(value), null);
  }
});

test("live price evidence contains both direct discount and quantity bundle semantics", () => {
  assert.equal(fixture.totals.productsWithWasPrice, 87);
  assert.equal(fixture.totals.productsWithCombinaBundle, 15);

  const butter = fixture.observedUsItemIdConvention.representativeCrossValidatedProducts.find(
    (p) => p.label === "mantequilla-colun-250",
  );
  assert.ok(butter);
  assert.equal(butter.linePrice, 2990);
  assert.equal(butter.wasPrice, 3290);
  assert.ok(butter.promoFlags.some((p) => p.key === "ROLLBACK"));

  const coke = fixture.observedUsItemIdConvention.representativeCrossValidatedProducts.find(
    (p) => p.label === "coca-original-591",
  );
  assert.ok(coke);
  assert.ok(coke.promoFlags.some((p) => p.key === "COMBINA" && p.text === "Combina 2 x $1.950"));
});

test("missing Lider availabilityStatus remains UNKNOWN evidence, never implicit AVAILABLE", () => {
  assert.equal(fixture.totals.productsWithNonNullAvailabilityStatus, 0);
  for (const product of fixture.observedUsItemIdConvention.representativeCrossValidatedProducts) {
    assert.equal(product.availabilityStatus, null);
  }
});

test("member price field exists in schema but this sample does not prove a Mi Club price", () => {
  assert.equal(fixture.totals.productsWithMemberPrice, 0);
});
