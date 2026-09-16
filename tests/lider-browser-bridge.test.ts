import test from "node:test";
import assert from "node:assert/strict";
import {
  LiderChallengeError,
  LiderContractError,
  LiderLocalBrowserBridge,
  type LocalBrowserPagePort,
} from "../src/adapters/liderBrowserBridge.ts";

interface Inspection {
  pathname: string;
  challenge: boolean;
  nextDataText: string | null;
}

class FakePage implements LocalBrowserPagePort {
  readonly navigations: string[] = [];
  private currentUrl = "https://super.lider.cl/";
  private readonly inspections: Inspection[];

  constructor(inspections: Inspection[]) {
    this.inspections = inspections;
  }

  async goto(url: string): Promise<void> {
    this.navigations.push(url);
    this.currentUrl = url;
  }

  async evaluate<T>(_pageFunction: () => T): Promise<T> {
    const next = this.inspections.shift();
    if (!next) throw new Error("fake inspection exhausted");
    return next as T;
  }

  url(): string {
    return this.currentUrl;
  }
}

test("local Lider bridge performs one encoded search and returns transient SSR JSON", async () => {
  const page = new FakePage([{ pathname: "/search", challenge: false, nextDataText: '{"ok":true}' }]);
  const bridge = new LiderLocalBrowserBridge(page, { minIntervalMs: 0 });

  const result = await bridge.search("azúcar iansa");
  assert.deepEqual(result.nextData, { ok: true });
  assert.equal(result.source, "lider_local_browser_ssr:/search");
  assert.equal(page.navigations.length, 1);
  assert.equal(page.navigations[0], "https://super.lider.cl/search?query=az%C3%BAcar%20iansa");
});

test("local Lider bridge surfaces challenge and never retries", async () => {
  const page = new FakePage([{ pathname: "/search", challenge: true, nextDataText: null }]);
  const bridge = new LiderLocalBrowserBridge(page, { minIntervalMs: 0 });

  await assert.rejects(() => bridge.search("leche"), LiderChallengeError);
  assert.equal(page.navigations.length, 1);
});

test("local Lider bridge rejects unexpected navigation and missing Next data", async () => {
  const redirected = new FakePage([{ pathname: "/blocked", challenge: false, nextDataText: null }]);
  await assert.rejects(
    () => new LiderLocalBrowserBridge(redirected, { minIntervalMs: 0 }).search("leche"),
    LiderContractError,
  );
  assert.equal(redirected.navigations.length, 1);

  const missing = new FakePage([{ pathname: "/search", challenge: false, nextDataText: null }]);
  await assert.rejects(
    () => new LiderLocalBrowserBridge(missing, { minIntervalMs: 0 }).search("leche"),
    LiderContractError,
  );
  assert.equal(missing.navigations.length, 1);
});

test("local Lider bridge health check only accepts super.lider.cl", async () => {
  const page = new FakePage([]);
  const bridge = new LiderLocalBrowserBridge(page, { minIntervalMs: 0 });
  assert.equal((await bridge.healthCheck()).ok, true);

  await page.goto("https://example.com/");
  assert.equal((await bridge.healthCheck()).ok, false);
});
