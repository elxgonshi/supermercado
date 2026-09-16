/*
LIDER LIVE CONTRACT PROBE v1 — PUBLIC CATALOG FIELDS ONLY

Purpose
-------
Validate the current Lider search contract from a real browser session without
product-by-product clicking. The probe loads ten normal search result pages in
same-origin hidden iframes and reads the SSR __NEXT_DATA__ already delivered to
that browser.

Privacy / safety
----------------
- Does NOT read cookies, localStorage, sessionStorage, geolocation or headers.
- Does NOT solve/bypass CAPTCHA or anti-bot challenges.
- Does NOT call private APIs or replay tokens.
- Exports only public catalog/product fields and schema key names.
- Makes at most one browser navigation per configured query, sequentially.
- If Lider serves a blocked/challenge page, it records that fact and does not retry.
*/
(() => {
  'use strict';

  const HOST = location.hostname.toLowerCase();
  if (HOST !== 'super.lider.cl') {
    throw new Error('Ejecuta este snippet dentro de https://super.lider.cl');
  }

  if (window.__LIDER_SPIKE_V1__?.installed) {
    console.info('[Lider spike v1] Ya está instalado.');
    return;
  }

  const DEFAULT_QUERIES = [
    'mantequilla colun',
    'leche colun',
    'arroz banquete',
    'aceite chef',
    'fideos carozzi',
    'azúcar iansa',
    'huevos',
    'papel higiénico confort',
    'coca cola',
    'pechuga pollo',
  ];

  const results = [];
  let running = false;

  const uniq = (xs) => [...new Set(xs.filter(Boolean).map(String))].sort();

  const maybeString = (v) => (typeof v === 'string' && v.trim() ? v : null);
  const maybeFinite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  function safePriceInfo(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      itemPrice: maybeString(value.itemPrice),
      linePrice: maybeString(value.linePrice),
      wasPrice: maybeString(value.wasPrice),
      unitPrice: maybeString(value.unitPrice),
      savingsAmt: maybeFinite(value.savingsAmt),
      memberPriceString: maybeString(value.memberPriceString),
      keyNames: uniq(Object.keys(value)),
    };
  }

  function safeBadges(value) {
    if (!value || typeof value !== 'object') return null;
    const flags = Array.isArray(value.flags)
      ? value.flags.slice(0, 20).map((flag) => ({
          key: maybeString(flag?.key),
          text: maybeString(flag?.text),
          type: maybeString(flag?.type),
          keyNames: flag && typeof flag === 'object' ? uniq(Object.keys(flag)) : [],
        }))
      : [];
    return {
      keyNames: uniq(Object.keys(value)),
      flags,
    };
  }

  function safeProduct(p) {
    const identifierCandidates = {
      usItemId: maybeString(p.usItemId),
      id: maybeString(p.id),
      productId: maybeString(p.productId),
      upc: maybeString(p.upc),
      gtin: maybeString(p.gtin),
      ean: maybeString(p.ean),
      skuId: maybeString(p.skuId),
      sku: maybeString(p.sku),
    };

    return {
      __typename: maybeString(p.__typename),
      keyNames: uniq(Object.keys(p)),
      identifierCandidates,
      name: maybeString(p.name),
      brand: maybeString(p.brand),
      canonicalUrl: maybeString(p.canonicalUrl),
      availabilityStatus: maybeString(p.availabilityStatus),
      salesUnitType: maybeString(p.salesUnitType),
      shortDescription: maybeString(p.shortDescription),
      priceInfo: safePriceInfo(p.priceInfo),
      badges: safeBadges(p.badges),
    };
  }

  function collectProductObjects(root) {
    const products = [];
    const seenNodes = new WeakSet();
    const seenProducts = new Set();
    const maxDepth = 24;
    const maxNodes = 150000;
    let visited = 0;

    function visit(node, depth) {
      if (visited >= maxNodes || depth > maxDepth || node === null || typeof node !== 'object') return;
      visited++;
      if (seenNodes.has(node)) return;
      seenNodes.add(node);

      if (!Array.isArray(node) && node.__typename === 'Product') {
        const key = String(
          node.usItemId ?? node.id ?? node.productId ?? node.canonicalUrl ?? node.name ?? products.length,
        );
        if (!seenProducts.has(key)) {
          seenProducts.add(key);
          products.push(node);
        }
      }

      if (Array.isArray(node)) {
        for (const child of node) visit(child, depth + 1);
        return;
      }
      for (const key of Object.keys(node)) visit(node[key], depth + 1);
    }

    visit(root, 0);
    return { products, visitedNodes: visited };
  }

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
    const bodyText = (doc.body?.innerText || '').slice(0, 2000).toLowerCase();
    return {
      robotOrHuman: title.includes('robot or human') || bodyText.includes('robot or human'),
      blockedWord: title.includes('blocked') || bodyText.includes('blocked'),
    };
  }

  function inspectDocument(doc, query, sourceMode) {
    const next = parseNextData(doc);
    const challenge = challengeSignals(doc);
    const rscScriptCount = [...doc.scripts].filter((s) => (s.textContent || '').includes('self.__next_f')).length;

    if (!next.parsed) {
      return {
        query,
        sourceMode,
        pagePathname: doc.location?.pathname || '/search',
        nextDataFound: next.found,
        nextDataParseError: next.parseError,
        rscScriptCount,
        challenge,
        productCount: 0,
        aggregateProductKeyNames: [],
        aggregatePriceInfoKeyNames: [],
        identifierCandidateKeyNamesPresent: [],
        products: [],
      };
    }

    const collected = collectProductObjects(next.parsed);
    const publicProducts = collected.products.slice(0, 80).map(safeProduct);
    const aggregateProductKeyNames = uniq(publicProducts.flatMap((p) => p.keyNames));
    const aggregatePriceInfoKeyNames = uniq(publicProducts.flatMap((p) => p.priceInfo?.keyNames ?? []));
    const identifierCandidateKeyNamesPresent = uniq(
      publicProducts.flatMap((p) =>
        Object.entries(p.identifierCandidates)
          .filter(([, value]) => value !== null)
          .map(([key]) => key),
      ),
    );

    return {
      query,
      sourceMode,
      pagePathname: doc.location?.pathname || '/search',
      nextDataFound: true,
      nextDataParseError: null,
      rscScriptCount,
      challenge,
      visitedJsonNodes: collected.visitedNodes,
      productCount: publicProducts.length,
      aggregateProductKeyNames,
      aggregatePriceInfoKeyNames,
      identifierCandidateKeyNamesPresent,
      products: publicProducts,
    };
  }

  function removeFrame(frame) {
    try { frame.remove(); } catch {}
  }

  async function inspectQueryInFrame(query, timeoutMs = 25000) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;';
    const target = `/search?query=${encodeURIComponent(query)}`;

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        removeFrame(frame);
        resolve(value);
      };

      const timer = setTimeout(() => {
        finish({
          query,
          sourceMode: 'same-origin-iframe',
          error: 'timeout',
          productCount: 0,
          products: [],
        });
      }, timeoutMs);

      frame.addEventListener('load', () => {
        setTimeout(() => {
          try {
            const href = frame.contentWindow?.location?.href || '';
            if (href === 'about:blank') return;

            const doc = frame.contentDocument;
            if (!doc) {
              finish({ query, sourceMode: 'same-origin-iframe', error: 'no-content-document', productCount: 0, products: [] });
              return;
            }
            finish(inspectDocument(doc, query, 'same-origin-iframe'));
          } catch (error) {
            finish({
              query,
              sourceMode: 'same-origin-iframe',
              error: error instanceof Error ? error.message : String(error),
              productCount: 0,
              products: [],
            });
          }
        }, 1200);
      });

      frame.src = target;
      document.documentElement.appendChild(frame);
    });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function run(queries = DEFAULT_QUERIES) {
    if (running) throw new Error('El probe ya está ejecutándose.');
    if (!Array.isArray(queries) || queries.length === 0) throw new Error('queries debe ser un arreglo no vacío.');
    if (queries.length > 15) throw new Error('Máximo 15 búsquedas por corrida.');

    results.length = 0;
    running = true;
    console.info(`[Lider spike v1] Iniciando ${queries.length} búsquedas secuenciales...`);

    try {
      for (let i = 0; i < queries.length; i++) {
        const query = String(queries[i] || '').trim();
        if (!query) continue;
        console.info(`[Lider spike v1] ${i + 1}/${queries.length}: ${query}`);
        const result = await inspectQueryInFrame(query);
        results.push(result);
        const challenge = result.challenge?.robotOrHuman || result.challenge?.blockedWord;
        console.info(
          `[Lider spike v1] ${query}: products=${result.productCount ?? 0}, nextData=${result.nextDataFound ?? false}, challenge=${Boolean(challenge)}`,
        );
        await sleep(1500);
      }
    } finally {
      running = false;
    }

    console.info('[Lider spike v1] Terminado. Ejecuta __LIDER_SPIKE_V1__.status() y luego .download().');
    return status();
  }

  function captureCurrent(queryLabel = 'current-page') {
    const value = inspectDocument(document, String(queryLabel), 'current-document');
    results.push(value);
    return value;
  }

  function status() {
    const rows = results.map((r) => ({
      query: r.query,
      products: r.productCount ?? 0,
      nextData: r.nextDataFound ?? false,
      rscScripts: r.rscScriptCount ?? 0,
      identifiers: (r.identifierCandidateKeyNamesPresent ?? []).join(', '),
      challenge: Boolean(r.challenge?.robotOrHuman || r.challenge?.blockedWord),
      error: r.error ?? '',
    }));
    console.table(rows);
    return {
      running,
      completed: results.length,
      successfulQueries: results.filter((r) => (r.productCount ?? 0) > 0).length,
      results: rows,
    };
  }

  function buildExport() {
    return {
      schemaVersion: '1.0-lider-live-contract-public-fields',
      generatedAt: new Date().toISOString(),
      origin: location.origin,
      privacy: {
        cookiesRead: false,
        localStorageRead: false,
        sessionStorageRead: false,
        geolocationRead: false,
        requestHeadersStored: false,
        responseHeadersStored: false,
        htmlStored: false,
        tokensStored: false,
        addressesStored: false,
        note: 'Exports only public product/catalog fields already present in SSR plus schema key names.',
      },
      requestPolicy: {
        mechanism: 'sequential same-origin iframe navigation',
        retries: 0,
        delayMsBetweenQueries: 1500,
        captchaBypass: false,
      },
      configuredQueries: [...DEFAULT_QUERIES],
      results,
    };
  }

  function download(filename = 'lider-live-contract-v1.sanitized.json') {
    const blob = new Blob([JSON.stringify(buildExport(), null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const api = {
    installed: true,
    DEFAULT_QUERIES: [...DEFAULT_QUERIES],
    results,
    run,
    captureCurrent,
    status,
    download,
    exportObject: buildExport,
  };

  Object.defineProperty(window, '__LIDER_SPIKE_V1__', {
    value: api,
    enumerable: false,
    configurable: true,
    writable: false,
  });

  console.info('[Lider spike v1] Instalado.');
  console.info('[Lider spike v1] Ejecuta: await __LIDER_SPIKE_V1__.run()');
})();
