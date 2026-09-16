import type {
  LiderBridgeHealth,
  LiderBridgeSearchResult,
  LiderSearchBridge,
} from "./lider.ts";

export interface LocalBrowserPagePort {
  goto(
    url: string,
    options: { readonly waitUntil: "domcontentloaded"; readonly timeout: number },
  ): Promise<unknown>;
  evaluate<T>(pageFunction: () => T): Promise<T>;
  url(): string;
}

export interface LiderLocalBrowserBridgeOptions {
  readonly timeoutMs?: number;
  readonly minIntervalMs?: number;
}

export class LiderChallengeError extends Error {
  constructor(message = "Lider served an anti-bot/challenge page") {
    super(message);
    this.name = "LiderChallengeError";
  }
}

export class LiderContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiderContractError";
  }
}

interface BrowserInspection {
  readonly pathname: string;
  readonly challenge: boolean;
  readonly nextDataText: string | null;
}

/**
 * Thin local-browser transport for Líder.
 *
 * It intentionally depends only on a tiny Page-shaped port, so Playwright (or a
 * different legitimate local browser runner) stays outside the central adapter.
 * Requests are serialized and rate-limited. There are no automatic retries and
 * challenge pages are surfaced as typed errors instead of being bypassed.
 *
 * `__NEXT_DATA__` is read transiently in memory and is never written by this
 * bridge. The LiderAdapter immediately reduces it to normalized public fields.
 */
export class LiderLocalBrowserBridge implements LiderSearchBridge {
  private readonly page: LocalBrowserPagePort;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private lastStartedAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    page: LocalBrowserPagePort,
    options: LiderLocalBrowserBridgeOptions = {},
  ) {
    this.page = page;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.minIntervalMs = options.minIntervalMs ?? 1_500;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Lider browser timeoutMs must be positive");
    }
    if (!Number.isFinite(this.minIntervalMs) || this.minIntervalMs < 0) {
      throw new Error("Lider browser minIntervalMs must be non-negative");
    }
  }

  search(query: string): Promise<LiderBridgeSearchResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return Promise.reject(new Error("Lider search query must not be empty"));

    return new Promise<LiderBridgeSearchResult>((resolve, reject) => {
      this.queue = this.queue
        .then(async () => {
          try {
            resolve(await this.runSearch(normalizedQuery));
          } catch (error) {
            reject(error);
          }
        })
        .catch(() => {
          // The caller receives the original rejection above. Keep the internal
          // queue alive so one failed request cannot deadlock later searches.
        });
    });
  }

  private async runSearch(query: string): Promise<LiderBridgeSearchResult> {
    const waitMs = this.minIntervalMs - (Date.now() - this.lastStartedAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    this.lastStartedAt = Date.now();
    const target = `https://super.lider.cl/search?query=${encodeURIComponent(query)}`;
    await this.page.goto(target, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });

    const inspection = await this.page.evaluate<BrowserInspection>(() => {
      const title = (document.title || "").toLowerCase();
      const bodyText = (document.body?.innerText || "").slice(0, 2_000).toLowerCase();
      const challenge =
        title.includes("robot or human") ||
        bodyText.includes("robot or human") ||
        title.includes("blocked") ||
        bodyText.includes("blocked");
      const script = document.querySelector("script#__NEXT_DATA__");
      return {
        pathname: location.pathname,
        challenge,
        nextDataText: script?.textContent || null,
      };
    });

    if (inspection.challenge) throw new LiderChallengeError();
    if (inspection.pathname !== "/search") {
      throw new LiderContractError(`Unexpected Lider navigation: ${inspection.pathname}`);
    }
    if (!inspection.nextDataText) {
      throw new LiderContractError("Lider search page did not expose __NEXT_DATA__");
    }

    let nextData: unknown;
    try {
      nextData = JSON.parse(inspection.nextDataText) as unknown;
    } catch {
      throw new LiderContractError("Lider __NEXT_DATA__ was not valid JSON");
    }

    return {
      nextData,
      observedAt: new Date().toISOString(),
      source: "lider_local_browser_ssr:/search",
    };
  }

  async healthCheck(): Promise<LiderBridgeHealth> {
    let url: URL;
    try {
      url = new URL(this.page.url());
    } catch {
      return { ok: false, message: "local browser page has no valid URL" };
    }
    return url.hostname === "super.lider.cl"
      ? { ok: true, message: "local browser is attached to super.lider.cl" }
      : { ok: false, message: `local browser is on unexpected host: ${url.hostname}` };
  }
}
