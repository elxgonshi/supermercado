import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "spikes", "lider_browser_probe_v1.js"), "utf-8");

test("Lider browser probe is valid JavaScript syntax", () => {
  assert.doesNotThrow(() => new Function(source));
});

test("Lider browser probe contains the ten agreed pilot queries", () => {
  const expected = [
    "mantequilla colun",
    "leche colun",
    "arroz banquete",
    "aceite chef",
    "fideos carozzi",
    "azúcar iansa",
    "huevos",
    "papel higiénico confort",
    "coca cola",
    "pechuga pollo",
  ];
  for (const query of expected) assert.match(source, new RegExp(query, "u"));
});

test("Lider browser probe does not read browser secrets or geolocation", () => {
  for (const forbidden of [
    "document.cookie",
    "localStorage.getItem",
    "sessionStorage.getItem",
    "navigator.geolocation",
    "authorization",
    "x-api-key",
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden probe primitive: ${forbidden}`);
  }
});

test("Lider browser probe has no retry loop and records captchaBypass false", () => {
  assert.match(source, /retries:\s*0/u);
  assert.match(source, /captchaBypass:\s*false/u);
  assert.equal(source.includes("while ("), false);
});

test("Lider browser probe treats EAN/UPC/GTIN only as explicit identifier candidates", () => {
  for (const field of ["upc", "gtin", "ean"]) {
    assert.match(source, new RegExp(`${field}: maybeString\\(p\\.${field}\\)`, "u"));
  }
  assert.match(source, /usItemId:\s*maybeString\(p\.usItemId\)/u);
});
