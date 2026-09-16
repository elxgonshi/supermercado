import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidGtin,
  matchStoreProducts,
  normalizeGtin,
  normalizeText,
  parsePackSize,
  type StoreProduct,
} from "../src/catalog.ts";

function product(overrides: Partial<StoreProduct> = {}): StoreProduct {
  return {
    store: "jumbo",
    storeProductId: "base",
    sku: null,
    gtin: null,
    rawName: "Mantequilla Colun con sal 250 g",
    brand: "Colun",
    family: "Mantequilla",
    variant: "con sal",
    quantity: 250,
    unit: "g",
    packageCount: 1,
    category: null,
    url: null,
    imageUrl: null,
    canonicalProductId: null,
    ...overrides,
  };
}

test("normalizeText normalizes accents, case and punctuation", () => {
  assert.equal(normalizeText("Azúcar Rubia IANSA, 500 g"), "azucar rubia iansa 500 g");
});

test("GTIN validation accepts valid values and rejects invalid checksums", () => {
  assert.equal(isValidGtin("7802920203300"), true);
  assert.equal(normalizeGtin("7802920203300"), "07802920203300");
  assert.equal(normalizeGtin("7802920203301"), null);
});

test("GTIN normalization rejects all-zero feed placeholders", () => {
  for (const gtin of ["00000000", "000000000000", "0000000000000", "00000000000000"]) {
    assert.equal(normalizeGtin(gtin), null);
  }
});

test("all-zero placeholders can never establish gtin_exact identity", () => {
  const left = product({
    gtin: "0000000000000",
    brand: null,
    family: null,
    variant: null,
    quantity: null,
    unit: null,
    packageCount: null,
    rawName: "Producto A",
  });
  const right = product({
    store: "unimarc",
    gtin: "0000000000000",
    brand: null,
    family: null,
    variant: null,
    quantity: null,
    unit: null,
    packageCount: null,
    rawName: "Producto B",
  });
  const result = matchStoreProducts(left, right);
  assert.notEqual(result.strategy, "gtin_exact");
  assert.notEqual(result.kind, "confirmed");
});

for (const [name, expected] of [
  ["Mantequilla Colun 250 g", { quantity: 250, unit: "g", packageCount: 1 }],
  ["Azúcar Iansa 1.7 Kg", { quantity: 1700, unit: "g", packageCount: 1 }],
  ["Bebida Coca Cola 1 L", { quantity: 1000, unit: "ml", packageCount: 1 }],
  ["Bebida Coca Cola botella 591 ml", { quantity: 591, unit: "ml", packageCount: 1 }],
  ["Pack bebida lata 6 un de 350 ml", { quantity: 350, unit: "ml", packageCount: 6 }],
  ["Pack agua 2 x 1.5 L", { quantity: 1500, unit: "ml", packageCount: 2 }],
  ["Arroz 1.000 g", { quantity: 1000, unit: "g", packageCount: 1 }],
  ["Arroz 1,000 g", { quantity: 1000, unit: "g", packageCount: 1 }],
  ["Bebida 1,500 ml", { quantity: 1500, unit: "ml", packageCount: 1 }],
  ["Bebida 1,5 L", { quantity: 1500, unit: "ml", packageCount: 1 }],
  ["Bebida 1.5 L", { quantity: 1500, unit: "ml", packageCount: 1 }],
  ["Harina 1.000 kg", { quantity: 1000, unit: "g", packageCount: 1 }],
  ["Sazonador 1.5 g", { quantity: 1.5, unit: "g", packageCount: 1 }],
  ["Sazonador 0.250 g", { quantity: 0.25, unit: "g", packageCount: 1 }],
] as const) {
  test(`parsePackSize parses ${name}`, () => {
    assert.deepEqual(parsePackSize(name), expected);
  });
}

test("parsePackSize does not guess mixed-format packs", () => {
  assert.equal(parsePackSize("Pack Coca Cola 2 un de 3 L + Sprite 1 un de 3 L"), null);
});

test("GTIN normalization ignores observed retailer placeholder namespace", () => {
  assert.equal(normalizeGtin("9990000000135"), null);
});

test("GTIN normalization canonicalizes equivalent lengths", () => {
  // UPC-A 036000291452 is equivalent to zero-padded GTIN-14 00036000291452.
  assert.equal(normalizeGtin("036000291452"), "00036000291452");
  assert.equal(normalizeGtin("00036000291452"), "00036000291452");
});

test("matching confirms exact valid GTIN first", () => {
  const left = product({ gtin: "7802920203300" });
  const right = product({ store: "unimarc", storeProductId: "410", rawName: "Mantequilla Colun con sal pan 250 g", gtin: "7802920203300" });
  const result = matchStoreProducts(left, right);
  assert.equal(result.kind, "confirmed");
  assert.equal(result.strategy, "gtin_exact");
});

test("matching rejects different valid GTINs even when names are similar", () => {
  const left = product({ gtin: "7802920203300" });
  const right = product({ store: "unimarc", gtin: "7802920203102" });
  assert.deepEqual(matchStoreProducts(left, right), {
    kind: "no_match",
    strategy: "incompatible",
    reasons: ["valid GTIN differs"],
  });
});

test("retailer placeholder GTIN does not hard-reject an otherwise deterministic match", () => {
  const left = product({ gtin: "7802920203300" });
  const right = product({ store: "unimarc", gtin: "9990000000135" });
  const result = matchStoreProducts(left, right);
  assert.equal(result.kind, "confirmed");
  assert.equal(result.strategy, "deterministic");
});

test("matching confirms deterministic attributes when GTIN is unavailable", () => {
  const result = matchStoreProducts(product(), product({ store: "unimarc", storeProductId: "410" }));
  assert.equal(result.kind, "confirmed");
  assert.equal(result.strategy, "deterministic");
});

test("matching does not auto-confirm when variant is missing on both sides", () => {
  const left = product({ variant: null, rawName: "Leche Colun 1 L" });
  const right = product({ store: "unimarc", variant: null, rawName: "Leche Colun 1 litro" });
  const result = matchStoreProducts(left, right);
  assert.notEqual(result.kind, "confirmed");
});

test("matching rejects different variants", () => {
  const left = product({ variant: "con sal" });
  const right = product({ store: "unimarc", variant: "sin sal", rawName: "Mantequilla Colun sin sal 250 g" });
  assert.equal(matchStoreProducts(left, right).kind, "no_match");
});

test("matching rejects different package counts", () => {
  const left = product({ rawName: "Bebida Coca Cola 350 ml", brand: "Coca Cola", family: "Bebida", variant: "original", quantity: 350, unit: "ml", packageCount: 1 });
  const right = product({ store: "unimarc", rawName: "Pack Bebida Coca Cola original 6 un de 350 ml", brand: "Coca Cola", family: "Bebida", variant: "original", quantity: 350, unit: "ml", packageCount: 6 });
  assert.equal(matchStoreProducts(left, right).kind, "no_match");
});

test("strong text-only similarity goes to review, never auto-confirms", () => {
  const left = product({ brand: null, family: null, variant: null, quantity: null, unit: null, packageCount: null, rawName: "Detergente líquido Ariel concentrado 3 L" });
  const right = product({ store: "unimarc", brand: null, family: null, variant: null, quantity: null, unit: null, packageCount: null, rawName: "Detergente liquido Ariel concentrado 3 litros" });
  const result = matchStoreProducts(left, right, { reviewThreshold: 0.6 });
  assert.equal(result.kind, "review");
  assert.equal(result.strategy, "textual_review");
});

test("similar volume alone does not make products equal", () => {
  const left = product({ brand: "Coca Cola", family: "Bebida", variant: "original", quantity: 1000, unit: "ml", rawName: "Bebida Coca Cola original 1 L" });
  const right = product({ store: "unimarc", brand: "Sprite", family: "Bebida", variant: "original", quantity: 1000, unit: "ml", rawName: "Bebida Sprite original 1 L" });
  assert.equal(matchStoreProducts(left, right).kind, "no_match");
});

// Public identity fields recovered from the validated Jumbo jumboclj955 pilot
// and the sanitized Unimarc UI captures from 2026-09-03. Prices are deliberately
// omitted: price/promotion/stock must never participate in identity matching.
const REAL_EXACT_PAIRS = [
  {
    label: "Mantequilla Colun con sal 250 g",
    jumbo: { storeProductId: "6782", sku: "6870", gtin: "7802920203300", rawName: "Mantequilla Colun con Sal 250 g" },
    unimarc: { storeProductId: "410", sku: "410", gtin: "7802920203300", rawName: "Mantequilla Colun con sal pan 250 g" },
  },
  {
    label: "Leche Colun entera 1 L",
    jumbo: { storeProductId: "6609", sku: "6697", gtin: "7802920777542", rawName: "Leche Colun Entera 1 L" },
    unimarc: { storeProductId: "2896", sku: "2896", gtin: "7802920777542", rawName: "Leche entera natural Colun sin tapa 1 L" },
  },
  {
    label: "Azúcar blanca Iansa 1 Kg",
    jumbo: { storeProductId: "1633", sku: "1638", gtin: "7801505231912", rawName: "Azúcar Iansa 1 Kg" },
    unimarc: { storeProductId: "62", sku: "62", gtin: "7801505231912", rawName: "Azúcar blanca Iansa 1 Kg" },
  },
  {
    label: "Coca-Cola Zero 1.5 L",
    jumbo: { storeProductId: "498", sku: "500", gtin: "7801610350409", rawName: "Coca-Cola Zero 1,5 L" },
    unimarc: { storeProductId: "659", sku: "659", gtin: "7801610350409", rawName: "Bebida Coca Cola zero 1.5 L" },
  },
  {
    label: "Confort Rendiplus 12 un",
    jumbo: { storeProductId: "129980", sku: "130279", gtin: "7806500508656", rawName: "Confort Rendiplus 12 un" },
    unimarc: { storeProductId: "86702", sku: "86702", gtin: "7806500508656", rawName: "Papel higiénico Confort doble hoja rendiplus 12 un 27 mt" },
  },
] as const;

for (const pair of REAL_EXACT_PAIRS) {
  test(`real pilot GTIN confirms ${pair.label}`, () => {
    const left = product({
      store: "jumbo",
      storeProductId: pair.jumbo.storeProductId,
      sku: pair.jumbo.sku,
      gtin: pair.jumbo.gtin,
      rawName: pair.jumbo.rawName,
      brand: null,
      family: null,
      variant: null,
      quantity: null,
      unit: null,
      packageCount: null,
    });
    const right = product({
      store: "unimarc",
      storeProductId: pair.unimarc.storeProductId,
      sku: pair.unimarc.sku,
      gtin: pair.unimarc.gtin,
      rawName: pair.unimarc.rawName,
      brand: null,
      family: null,
      variant: null,
      quantity: null,
      unit: null,
      packageCount: null,
    });
    const result = matchStoreProducts(left, right);
    assert.equal(result.kind, "confirmed");
    assert.equal(result.strategy, "gtin_exact");
  });
}

test("real Banquete pilot does not match merely because query, brand and format look similar", () => {
  const jumbo = product({
    store: "jumbo",
    storeProductId: "1570",
    sku: "1574",
    gtin: "7803110102212",
    rawName: "Arroz Banquete Premium 1 kg",
    brand: "Banquete",
    family: "Arroz",
    variant: "premium",
    quantity: 1000,
    unit: "g",
    packageCount: 1,
  });
  const unimarc = product({
    store: "unimarc",
    storeProductId: "32",
    sku: "32",
    gtin: "7801420950660",
    rawName: "Arroz Banquete premium G1 1 Kg",
    brand: "Banquete",
    family: "Arroz",
    variant: "premium",
    quantity: 1000,
    unit: "g",
    packageCount: 1,
  });

  assert.deepEqual(matchStoreProducts(jumbo, unimarc), {
    kind: "no_match",
    strategy: "incompatible",
    reasons: ["valid GTIN differs"],
  });
});
