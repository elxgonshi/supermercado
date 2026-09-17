import test from "node:test";
import assert from "node:assert/strict";
import {
  LiderAdapter,
  type LiderBridgeSearchResult,
  type LiderSearchBridge,
} from "../src/adapters/lider.ts";

class SequenceBridge implements LiderSearchBridge {
  private index = 0;
  private readonly responses: LiderBridgeSearchResult[];

  constructor(responses: LiderBridgeSearchResult[]) {
    this.responses = responses;
  }

  async search(_query: string): Promise<LiderBridgeSearchResult> {
    const value = this.responses[this.index++];
    if (!value) throw new Error("sequence bridge exhausted");
    return value;
  }
}

function product(usItemId: string, name: string) {
  return {
    __typename: "Product",
    usItemId,
    name,
    brand: "Test",
    canonicalUrl: `/ip/test/${usItemId}`,
    priceInfo: { linePrice: "$1.000" },
    availabilityStatusDisplayValue: "In stock",
    isOutOfStock: false,
    canAddToCart: true,
    showAtc: true,
  };
}

test("two UNKNOWN Lider branch contexts never share stale cached products", async () => {
  const adapter = new LiderAdapter(new SequenceBridge([
    {
      nextData: { search: { items: [product("00780000000001", "Solo primera búsqueda, 1 un")] } },
      observedAt: "2026-09-16T03:10:00.000Z",
      source: "test:ssr",
    },
    {
      nextData: { search: { items: [product("00780000000002", "Solo segunda búsqueda, 1 un")] } },
      observedAt: "2026-09-16T03:11:00.000Z",
      source: "test:ssr",
    },
  ]));

  await adapter.searchProducts("primera");
  assert.equal((await adapter.resolveBranch()).scope, "UNKNOWN");
  assert.ok(await adapter.getProduct("00780000000001"));

  await adapter.searchProducts("segunda");
  assert.equal((await adapter.resolveBranch()).scope, "UNKNOWN");
  assert.equal(await adapter.getProduct("00780000000001"), null);
  assert.ok(await adapter.getProduct("00780000000002"));
});
