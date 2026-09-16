# Líder — auditoría live contract 2026-09-15/16

## Objetivo

Validar el contrato real de Líder antes de integrarlo al catálogo, matching y optimizador. No se asume que endpoints, bloqueo antibot, SSR o campos observados en julio de 2026 sigan vigentes.

## Evidencia actual

### Live probe v1 — 2026-09-16

Se ejecutó `spikes/lider_browser_probe_v1.js` desde Chrome real con la tienda/dirección normal seleccionada.

Resultado:

- 10/10 búsquedas configuradas completaron con `__NEXT_DATA__` parseable;
- 0/10 mostraron `Robot or human` o señal de bloqueo;
- 301 nodos `Product` fueron capturados en total;
- conteos por búsqueda: mantequilla Colun 4, leche Colun 44, arroz Banquete 19, aceite Chef 8, fideos Carozzi 31, azúcar Iansa 50, huevos 44, Confort 32, Coca-Cola 25 y pechuga pollo 44;
- 301/301 productos expusieron `usItemId` + `id` interno;
- 0/301 expusieron campos explícitos `ean`, `upc` o `gtin` en el nodo de búsqueda;
- 87/301 trajeron `wasPrice` y un precio vigente menor, consistente con rebaja directa;
- 15/301 trajeron badge `COMBINA` con promociones por cantidad;
- 0/301 trajeron `memberPriceString` no vacío;
- 0/301 trajeron `availabilityStatus` no nulo.

La fixture compacta queda en `tests/fixtures/lider-live-contract-summary-2026-09-16.json`.

### Live probe v2 — stock y contexto local

Se ejecutó `spikes/lider_stock_context_probe_v2.js` sin repetir el piloto completo. Solo consultó `mantequilla colun`, `coca cola` y `pechuga pollo`.

Resultado:

- 3/3 búsquedas con `__NEXT_DATA__` parseable;
- 0/3 challenge/bloqueo;
- 73 productos observados;
- 69/73 mostraron un patrón de disponibilidad completamente consistente: `availabilityStatusDisplayValue = "In stock"`, `isOutOfStock = false`, `canAddToCart = true`, `showAtc = true`;
- 4/73 mostraron el patrón inverso y consistente de no disponibilidad: `availabilityStatusDisplayValue = "Out of stock"`, `isOutOfStock = true`, `canAddToCart = false`, `showAtc = false`;
- los cuatro casos OOS son controles positivos reales dentro de la misma búsqueda, por lo que ya no necesitamos inferir stock a partir de la ausencia de `availabilityStatus`;
- las tres búsquedas expusieron el mismo `storeId = "0000000094"` en `props.pageProps.initialData.contentLayout.modules[1].configs.ad.storeId`;
- no se guardó dirección, código postal, geocoordenadas, cookies, storage, headers ni tokens.

La fixture compacta queda en `tests/fixtures/lider-stock-context-summary-2026-09-16.json`.

### Límite de la evidencia de contexto local

El `storeId` es evidencia de que el SSR de la sesión seleccionada transporta un identificador técnico de tienda/contexto. **No se hizo un A/B cambiando de tienda**, por lo que esta auditoría no afirma que `0000000094` sea una sucursal física concreta ni cuantifica cuánto cambian precio/stock entre tiendas.

Para la primera versión productiva esto se tratará como contexto de tienda opaco de la sesión:

- `resolveBranch()` puede devolver el `storeId` observado cuando exista;
- cada `PriceObservation` debe conservar ese `branchId`/contexto;
- si el `storeId` falta, la observación se degrada a branch desconocida en vez de inventarla;
- el optimizador no debe comparar observaciones de contextos incompatibles como si fueran equivalentes.

No se hará otra ronda de probing solo para demostrar variación entre tiendas antes de construir el adapter.

## Repositorio de referencia `NLACE-COM/mcp-supermercados-cl`

El adapter de referencia usa `GET https://super.lider.cl/search?query={query}`, parsea `__NEXT_DATA__` y busca nodos `__typename: "Product"`. Su última validación real declarada fue 2026-07-09. También documentó HTTP plano bloqueado por PerimeterX/F5 el 2026-07-08. Es evidencia histórica, no contrato actual.

## Identidad — `usItemId` y EAN

El `usItemId` bruto **no es un GTIN válido** y nunca debe copiarse directamente a `StoreProduct.gtin`.

El v1 mostró una convención útil:

- 301/301 `usItemId` tenían 14 dígitos y prefijo `00`;
- al quitar los dos ceros quedan 12 dígitos;
- agregando el dígito verificador GS1 se reconstruye un EAN-13 candidato.

Regla observada:

`EAN13 candidato = usItemId.slice(2) + checkDigitGS1(usItemId.slice(2))`

La regla coincidió con identificadores ya confirmados en Jumbo/Unimarc para varios productos:

| Producto | Líder `usItemId` | EAN-13 reconstruido | Evidencia cruzada |
|---|---|---|---|
| Mantequilla Colun con sal 250 g | `00780292020330` | `7802920203300` | Jumbo + Unimarc |
| Leche Colun entera 1 L | `00780292077754` | `7802920777542` | Jumbo + Unimarc |
| Azúcar blanca Iansa 1 Kg | `00780150523191` | `7801505231912` | Jumbo + Unimarc |
| Arroz Banquete Grado 1 1 Kg | `00780311010221` | `7803110102212` | Jumbo |
| Coca-Cola original 591 ml | `00780161000057` | `7801610000571` | Unimarc |
| Coca-Cola Light 591 ml | `00780161000059` | `7801610000595` | Unimarc |

Esta transformación se considera **candidato de identidad**, no una garantía universal. En especial, productos de peso variable/internos con códigos de distribución restringida (por ejemplo IDs que reconstruyen EAN comenzando en `2`) no deben auto-confirmar matching cross-store. La implementación productiva debe aislar y validar la transformación y conservar `storeProductId` por separado.

## Precio y promociones

La captura actual confirma:

- `priceInfo.linePrice` = precio vigente mostrado;
- `priceInfo.wasPrice` = precio normal/tachado cuando existe rebaja;
- `priceInfo.unitPrice` = precio por unidad textual;
- `savingsAmt` fue coherente con `wasPrice - linePrice` en los casos revisados;
- badge `ROLLBACK / Rebaja` acompaña rebajas directas;
- badge `COMBINA` expone bundles como `Combina 2 x $1.950`;
- `memberPriceString` existe en el schema pero no apareció con valor en la muestra, por lo que Mi Club se modela como `null/unknown` y no se inventa.

## Stock — contrato actual

`availabilityStatus` histórico ya no sirve como señal primaria: fue `null` en la captura v1 completa. El v2 entrega señales actuales y coherentes.

Mapeo inicial recomendado:

- `UNAVAILABLE` cuando `isOutOfStock === true`, o cuando las señales públicas convergen en `Out of stock` + `canAddToCart === false` + `showAtc === false`;
- `AVAILABLE` cuando `isOutOfStock === false` y convergen `In stock` + `canAddToCart === true` + `showAtc === true`;
- `UNKNOWN` ante ausencia o contradicción de señales.

Nunca usar `availabilityStatus == null` como sinónimo de disponible.

## Clasificación de reutilización

| Parte upstream | Clasificación | Decisión |
|---|---|---|
| `src/adapters/lider.ts` — parser general | **ADAPTAR** | SSR + nodos `Product` siguen vigentes, pero stock e identidad requieren semántica nueva. |
| `src/adapters/nextData.ts` | **REUTILIZAR/ADAPTAR** | Extracción tolerante de `__NEXT_DATA__` sigue siendo útil. |
| `src/adapters/playwrightBridge.ts` | **SOLO REFERENCIA / ADAPTAR si hace falta** | Navegador local es fallback; no clicks producto por producto. |
| fixture histórica `lider-search-arroz.json` | **SOLO REFERENCIA** | Reemplazada como contrato por fixtures actuales propias. |
| fallback `inStock=true` si falta `availabilityStatus` | **NO REUTILIZAR** | Contradicho por evidencia live actual. |
| `usItemId` bruto como GTIN | **NO REUTILIZAR** | Es `store_product_id`; cualquier EAN derivado requiere transformación explícita y guardrails. |
| `linePrice` / `wasPrice` | **REUTILIZAR/ADAPTAR** | Semántica confirmada en vivo. |
| badges `ROLLBACK` / `COMBINA` | **REUTILIZAR/ADAPTAR** | Rebaja directa y bundle confirmados. |

## Gate de aprobación Líder

Estado después de v1 + v2:

1. **Search actual:** ✅ cerrado — 10/10 búsquedas, 301 productos, sin challenge.
2. **Identidad:** ✅ suficiente para adapter inicial — `storeProductId` seguro; EAN derivado solo como candidato con guardrails, nunca desde el `usItemId` bruto.
3. **Precio:** ✅ cerrado para precio público, rebaja directa, unit price y bundles `COMBINA`; Mi Club queda explícitamente `unknown/null` hasta observar evidencia positiva.
4. **Stock:** ✅ cerrado — 69 controles disponibles + 4 controles OOS con señales concordantes.
5. **Contexto local:** ✅ cerrado para collector session-scoped — SSR expone `storeId` estable en las tres búsquedas; no se afirma equivalencia con una sucursal física ni variación A/B entre tiendas.
6. **Fixtures sanitizadas:** ✅ v1 + v2 compactas y testeadas.
7. **Live smoke:** ✅ navegador real + SSR validado con pocas búsquedas, cero retries y sin bypass.

### Veredicto

**Contrato Líder APROBADO para construir el adapter inicial**, con estas restricciones explícitas:

- browser/SSR local como mecanismo de colección mientras HTTP plano no se revalide;
- `storeId` tratado como contexto opaco de la sesión;
- stock basado en señales actuales, no en `availabilityStatus` histórico;
- `usItemId` siempre separado de GTIN;
- EAN derivado solo como candidato y con rechazo de namespaces/códigos internos no autoritativos;
- Mi Club no se modela como descuento hasta tener evidencia positiva.

## Próximo paso

Construir el adapter productivo de Líder con parser puro testeable + bridge de navegador local separado, contract tests sobre fixtures sanitizadas y live smoke mínimo. Después de eso se puede habilitar `lider` en el optimizador solo si el adapter entrega observaciones con branch/contexto y stock válidos.
