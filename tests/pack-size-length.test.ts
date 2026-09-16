import test from "node:test";
import assert from "node:assert/strict";
import { parsePackSize } from "../src/catalog.ts";

test("parses toilet-paper rolls when retailer omits separator before meters", () => {
  assert.deepEqual(
    parsePackSize("Papel higiénico Confort doble hoja rendiplus 12 un 27 mt"),
    { quantity: 27, unit: "m", packageCount: 12 },
  );
});

test("parses explicit roll count and meters per roll", () => {
  assert.deepEqual(
    parsePackSize("Papel higiénico Confort mega doble hoja 4 un de 50 m"),
    { quantity: 50, unit: "m", packageCount: 4 },
  );
});
