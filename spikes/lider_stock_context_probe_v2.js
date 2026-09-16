/*
LIDER STOCK / LOCAL CONTEXT PROBE v2 — PRIVACY STRICT

Purpose
-------
Close the remaining Lider gates after the successful v1 live-contract capture:
1) observe stock/ATC signals currently present in public SSR product nodes;
2) discover safe branch/store identifier fields in __NEXT_DATA__;
3) avoid repeating the ten-query pilot.

Privacy / safety
----------------
- Same-origin browser navigation only.
- Exactly three configured searches, sequentially, zero retries.
- Does NOT read cookies, localStorage, sessionStorage, geolocation, headers or tokens.
- Does NOT export raw HTML or raw __NEXT_DATA__.
- Does NOT export address/postal/geo/customer/session/auth values.
- Does NOT solve or bypass CAPTCHA/challenges.
*/
(() => {
  'use strict';

  if (location.hostname.toLowerCase() !== 'super.lider.cl') {
    throw new Error('Ejecuta este snippet dentro de https://super.lider.cl');
  }

  if (window.__LIDER_STOCK_V2__?.installed) {
    console.info('[Lider stock v2] Ya está instalado.');
    return;
  }

  const QUERIES = ['mantequilla colun', 'coca cola', 'pechuga pollo'];
  const results = [];
  let running = false;

  const uniq = (xs) => [...new Set(xs.filter((x) => x !== null && x !== undefined).map(String))].sort();
  const stringOrNull = (v) => typeof v === 'string' && v.trim() ? v.trim() : null;
  const boolOrNull = (v) => typeof v === 'boolean' ? v : null;

  function parseNextData(doc) {
    const script = doc.querySelector('script#__NEXT_DATA__');
    if (!script) return { found: false, parsed: null, parseError: null };
    try {
      return { found: true, parsed: JSON.parse(script.textContent || ''), parseError: null };
    } catch (error) {
      return {
        found: true,
        parsed: null,
        parseError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function challengeSignals(doc) {
    const title = (doc.title || '').toLowerCase();
    const text = (doc.body?.innerText || '').slice(0, 2000).toLowerCase();
    return {
      robotOrHuman: title.includes('robot or human') || text.includes('robot or human'),
      blockedWord: title.includes('blocked') || text.includes('blocked'),
    };
  }

  function collectProducts(root) {
    const out = [];
    const seen = new WeakSet();
    const productKeys = new Set();
    let visited = 0;

    function walk(node, depth) {
      if (depth > 24 || visited >= 150000 || node === null || typeof node !== 'object') return;
      visited++;
      if (seen.has(node)) return;
      seen.add(node);

      if (!Array.isArray(node) && node.__typename === 'Product') {
        const key = String(node.usItemId ?? node.id ?? node.canonicalUrl ?? node.name ?? out.length);
        if (!productKeys.has(key)) {
          productKeys.add(key);
          out.push(node);
        }
      }

      if (Array.isArray(node)) {
        for (const child of node) walk(child, depth + 1);
      } else {
        for (const value of Object.values(node)) walk(value, depth + 1);
      }
    }

    walk(root, 0);
    return { products: out, visited };
  }

  const UNSAFE_PATH = /address|postal|zip|latitude|longitude|geo|coordinate|customer|session|token|cookie|auth|email|phone/i;
  const SAFE_CONTEXT_KEY = /^(storeId|storeIds|storeNumber|storeNumberId|fulfillmentStoreId|preferredStoreId|locationId)$/i;

  function safeContextScalar(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const s = value.trim();
    return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null;
  }

  function collectStoreContextCandidates(root) {
    const found = [];
    const seen = new WeakSet();
    let visited = 0;

    function walk(node, path, depth) {
      if (depth > 18 || visited >= 120000 || node === null || typeof node !== 'object') return;
      visited++;
      if (seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        node.forEach((child, index) => walk(child, `${path}[${index}]`, depth + 1));
        return;
      }

      for (const [key, value] of Object.entries(node)) {
        const nextPath = path ? `${path}.${key}` : key;
        if (!UNSAFE_PATH.test(nextPath) && SAFE_CONTEXT_KEY.test(key)) {
          if (Array.isArray(value)) {
            const values = value.map(safeContextScalar).filter((v) => v !== null).slice(0, 20);
            if (values.length) found.push({ path: nextPath, key, values });
          } else {
            const safe = safeContextScalar(value);
            if (safe !== null) found.push({ path: nextPath, key, values: [safe] });
          }
        }
        walk(value, nextPath, depth + 1);
      }
    }

    walk(root, '', 0);

    const byFingerprint = new Map();
    for (const entry of found) {
      const fingerprint = `${entry.path}|${JSON.stringify(entry.values)}`;
      if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, entry);
    }
    return [...byFingerprint.values()].slice(0, 100);
  }

  function safeNestedSignalObject(value) {
    if (!value || typeof value !== 'object') return null;
    const keyNames = uniq(Object.keys(value));
    const signals = [];

    function walk(node, path, depth) {
      if (depth > 3 || node === null || typeof node !== 'object') return;
      for (const [key, child] of Object.entries(node)) {
        const nextPath = path ? `${path}.${key}` : key;
        if (UNSAFE_PATH.test(nextPath)) continue;

        const safeKey = /status|available|availability|eligible|outofstock|canadd|showatc|fulfillment|method|type|speed/i.test(key);
        if (safeKey) {
          if (typeof child === 'boolean' || (typeof child === 'number' && Number.isFinite(child))) {
            signals.push({ path: nextPath, value: child });
          } else if (typeof child === 'string') {
            const s = child.trim();
            if (s && s.length <= 80) signals.push({ path: nextPath, value: s });
          }
        }
        if (child && typeof child === 'object') walk(child, nextPath, depth + 1);
      }
    }

    walk(value, '', 0);
    return { keyNames, signals: signals.slice(0, 80) };
  }

  function publicProduct(p) {
    return {
      usItemId: stringOrNull(p.usItemId),
      name: stringOrNull(p.name),
      brand: stringOrNull(p.brand),
      canonicalUrl: stringOrNull(p.canonicalUrl),
      linePrice: stringOrNull(p.priceInfo?.linePrice),
      wasPrice: stringOrNull(p.priceInfo?.wasPrice),
      memberPriceString: stringOrNull(p.priceInfo?.memberPriceString),
      stockSignals: {
        availabilityStatus: stringOrNull(p.availabilityStatus),
        availabilityStatusDisplayValue: stringOrNull(p.availabilityStatusDisplayValue),
        isOutOfStock: boolOrNull(p.isOutOfStock),
        canAddToCart: boolOrNull(p.canAddToCart),
        showAtc: boolOrNull(p.showAtc),
        checkStoreAvailabilityATC: boolOrNull(p.checkStoreAvailabilityATC),
        availabilityInNearbyStore: boolOrNull(p.availabilityInNearbyStore),
        seeShippingEligibility: boolOrNull(p.seeShippingEligibility),
        fulfillmentType: stringOrNull(p.fulfillmentType),
        fulfillmentTitle: stringOrNull(p.fulfillmentTitle),
        fulfillmentSpeed: stringOrNull(p.fulfillmentSpeed),
        availabilityStatusV2: safeNestedSignalObject(p.availabilityStatusV2),
        fulfillmentSummary: safeNestedSignalObject(p.fulfillmentSummary),
      },
      signalKeyNamesPresent: uniq([
        ...[
          'availabilityStatus',
          'availabilityStatusDisplayValue',
          'isOutOfStock',
          'canAddToCart',
          'showAtc',
          'checkStoreAvailabilityATC',
          'availabilityInNearbyStore',
          'seeShippingEligibility',
          'fulfillmentType',
          'fulfillmentTitle',
          'fulfillmentSpeed',
          'availabilityStatusV2',
          'fulfillmentSummary',
        ].filter((key) => Object.prototype.hasOwnProperty.call(p, key)),
      ]),
    };
  }

  function inspect(doc, query) {
    const challenge = challengeSignals(doc);
    const next = parseNextData(doc);
    if (!next.parsed) {
      return {
        query,
        nextDataFound: next.found,
        nextDataParseError: next.parseError,
        challenge,
        productCount: 0,
        storeContextCandidates: [],
        products: [],
      };
    }

    const collected = collectProducts(next.parsed);
    return {
      query,
      nextDataFound: true,
      nextDataParseError: null,
      challenge,
      visitedJsonNodes: collected.visited,
      productCount: collected.products.length,
      storeContextCandidates: collectStoreContextCandidates(next.parsed),
      products: collected.products.slice(0, 80).map(publicProduct),
    };
  }

  function removeFrame(frame) {
    try { frame.remove(); } catch {}
  }

  async function inspectQuery(query, timeoutMs = 25000) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;';
    const expected = `/search?query=${encodeURIComponent(query)}`;

    return await new Promise((resolve) => {
      let settled = false;
      let sawExpectedNavigation = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        removeFrame(frame);
        resolve(value);
      };

      const timer = setTimeout(() => {
        finish({ query, error: 'timeout', productCount: 0, storeContextCandidates: [], products: [] });
      }, timeoutMs);

      frame.addEventListener('load', () => {
        setTimeout(() => {
          try {
            const href = frame.contentWindow?.location?.href || '';
            const u = href ? new URL(href) : null;
            if (!u || u.hostname !== location.hostname || u.pathname !== '/search' || u.searchParams.get('query') !== query) {
              if (!sawExpectedNavigation) return;
            } else {
              sawExpectedNavigation = true;
            }

            const doc = frame.contentDocument;
            if (!doc) {
              finish({ query, error: 'no-content-document', productCount: 0, storeContextCandidates: [], products: [] });
              return;
            }
            finish(inspect(doc, query));
          } catch (error) {
            finish({
              query,
              error: error instanceof Error ? error.message : String(error),
              productCount: 0,
              storeContextCandidates: [],
              products: [],
            });
          }
        }, 1200);
      });

      frame.src = expected;
      document.documentElement.appendChild(frame);
    });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function run() {
    if (running) throw new Error('El probe ya está ejecutándose.');
    results.length = 0;
    running = true;

    try {
      for (let i = 0; i < QUERIES.length; i++) {
        const query = QUERIES[i];
        console.info(`[Lider stock v2] ${i + 1}/${QUERIES.length}: ${query}`);
        const result = await inspectQuery(query);
        results.push(result);
        if (result.challenge?.robotOrHuman || result.challenge?.blockedWord) {
          console.warn('[Lider stock v2] Challenge/bloqueo detectado. Se detiene sin reintentos.');
          break;
        }
        if (i < QUERIES.length - 1) await sleep(1500);
      }
    } finally {
      running = false;
    }

    console.info('[Lider stock v2] Fin.');
    return status();
  }

  function status() {
    const summary = results.map((r) => ({
      query: r.query,
      products: r.productCount ?? 0,
      nextData: !!r.nextDataFound,
      challenged: !!(r.challenge?.robotOrHuman || r.challenge?.blockedWord),
      contextCandidates: r.storeContextCandidates?.length ?? 0,
      unavailableSignals: (r.products ?? []).filter((p) =>
        p.stockSignals?.isOutOfStock === true ||
        p.stockSignals?.canAddToCart === false ||
        p.stockSignals?.showAtc === false
      ).length,
    }));
    console.table(summary);
    return summary;
  }

  function exportObject() {
    return {
      schemaVersion: '2.0-lider-stock-context-public-fields',
      generatedAt: new Date().toISOString(),
      origin: location.origin,
      privacy: {
        cookiesRead: false,
        localStorageRead: false,
        sessionStorageRead: false,
        geolocationRead: false,
        headersRead: false,
        rawHtmlStored: false,
        rawNextDataStored: false,
        addressesStored: false,
        postalCodesStored: false,
        geoCoordinatesStored: false,
        tokensStored: false,
      },
      requestPolicy: {
        configuredQueries: [...QUERIES],
        mechanism: 'sequential same-origin iframe navigation',
        retries: 0,
        delayMsBetweenQueries: 1500,
        captchaBypass: false,
      },
      results,
    };
  }

  function download(filename = 'lider-stock-context-v2.sanitized.json') {
    const blob = new Blob([JSON.stringify(exportObject(), null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  Object.defineProperty(window, '__LIDER_STOCK_V2__', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: {
      installed: true,
      run,
      status,
      exportObject,
      download,
      results,
    },
  });

  console.info('[Lider stock v2] Instalado. Ejecuta: await __LIDER_STOCK_V2__.run()');
})();
