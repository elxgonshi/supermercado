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
- los 301 productos expusieron `usItemId` + `id` interno;
- 0/301 expusieron campos explícitos `ean`, `upc` o `gtin` en el nodo de búsqueda capturado;
- 87/301 trajeron `wasPrice` y un precio vigente menor, consistente con rebaja directa;
- 15/301 trajeron badge `COMBINA` con promociones por cantidad, por ejemplo `Combina 2 x $1.950`;
- 0/301 trajeron `memberPriceString` no vacío en esta muestra;
- 0/301 trajeron `availabilityStatus` no nulo, pese a que el schema del nodo sí contiene varias señales alternativas de stock/ATC.

La fixture compacta y sanitizada queda en `tests/fixtures/lider-live-contract-summary-2026-09-16.json`. No se versionó el JSON completo de 301 productos porque no es necesario para el contrato y aumentaría ruido en el repo.

### Repositorio de referencia `NLACE-COM/mcp-supermercados-cl`

El adapter actual de referencia usa:

`GET https://super.lider.cl/search?query={query}`

El parser busca `__NEXT_DATA__` y nodos `__typename: "Product"` con campos como `usItemId`, `name`, `brand`, `canonicalUrl`, `availabilityStatus` y `priceInfo` (`linePrice`, `wasPrice`, `unitPrice`, `memberPriceString`). El último commit upstream que declara validación contra sitio real es del **2026-07-09** y reportó ~46 productos usando Chrome real.

La misma fuente documenta que el HTTP plano quedó bloqueado por PerimeterX/F5 el 2026-07-08 y que el fallback operativo es navegador real. Esa evidencia es histórica; nuestro v1 actual demuestra que el SSR sigue siendo legible desde navegador real, no que HTTP plano haya vuelto a ser confiable.

## Identidad — `usItemId` y EAN

El `usItemId` bruto **no es un GTIN válido** y nunca debe pasarse directamente a `StoreProduct.gtin`.

Sin embargo, el v1 actual reveló una convención mucho más útil:

- 301/301 `usItemId` tienen exactamente 14 dígitos y empiezan por `00`;
- al quitar los dos ceros quedan 12 dígitos;
- al calcular y añadir el dígito verificador GS1 de esos 12 dígitos se obtiene un EAN-13 válido.

Regla candidata observada:

`EAN13 candidato = usItemId.slice(2) + checkDigitGS1(usItemId.slice(2))`

La regla fue cruzada con productos cuyo EAN ya estaba confirmado en Jumbo/Unimarc:

| Producto | Líder `usItemId` | EAN-13 reconstruido | Evidencia cruzada |
|---|---|---|---|
| Mantequilla Colun con sal 250 g | `00780292020330` | `7802920203300` | coincide Jumbo + Unimarc |
| Leche Colun entera 1 L | `00780292077754` | `7802920777542` | coincide Jumbo + Unimarc |
| Azúcar blanca Iansa 1 Kg | `00780150523191` | `7801505231912` | coincide Jumbo + Unimarc |
| Arroz Banquete Grado 1 1 Kg | `00780311010221` | `7803110102212` | coincide con el producto Jumbo del piloto; Unimarc devolvió otro Banquete/EAN, correctamente distinto |
| Coca-Cola original 591 ml | `00780161000057` | `7801610000571` | coincide con Unimarc |
| Coca-Cola Light 591 ml | `00780161000059` | `7801610000595` | coincide con Unimarc |

Conclusión actual: la reconstrucción es **evidencia fuerte y utilizable como candidato de identidad**, pero el adapter no debe etiquetar el `usItemId` bruto como GTIN. La implementación productiva debe aislar la transformación en una función explícita y testeada, para poder deshabilitarla si el convenio de Walmart cambia.

## Precio y promociones

La captura actual confirma:

- `priceInfo.linePrice` = precio vigente mostrado;
- `priceInfo.wasPrice` = precio normal/tachado cuando existe rebaja;
- `priceInfo.unitPrice` = precio por unidad textual;
- `priceInfo.savingsAmt` fue coherente con `wasPrice - linePrice` en todos los casos de rebaja revisados;
- badge `ROLLBACK / Rebaja` acompaña las rebajas directas observadas;
- badge `COMBINA` expone bundles parseables como `Combina 2 x $1.950`, `Combina 3 x $2.000`, etc.;
- `memberPriceString` existe en el schema pero no apareció con valor en esta muestra, por lo que todavía no se declara un contrato Mi Club positivo.

## Stock — hallazgo del v1

El upstream histórico usa `availabilityStatus` y, si falta, llega a asumir disponibilidad. Eso **no es reutilizable**: en la captura actual `availabilityStatus` fue `null` en 301/301 productos.

El nodo actual sí contiene claves como:

- `isOutOfStock`;
- `canAddToCart`;
- `showAtc`;
- `availabilityStatusV2`;
- `availabilityStatusDisplayValue`;
- `availabilityInNearbyStore`;
- `fulfillmentSummary` / `fulfillmentType`.

El v1 solo exportó los nombres de esas claves, no sus valores. Por eso stock sigue abierto y se creó un probe v2 acotado a 3 búsquedas para capturar únicamente esas señales públicas.

## Clasificación de reutilización

| Parte upstream | Clasificación | Decisión |
|---|---|---|
| `src/adapters/lider.ts` — idea general de parser | **ADAPTAR** | SSR + `Product` sigue vigente, pero el contrato actual difiere en stock e identidad. |
| `src/adapters/nextData.ts` | **REUTILIZAR/ADAPTAR** | Extracción tolerante de `__NEXT_DATA__` sigue siendo útil. |
| `src/adapters/playwrightBridge.ts` | **SOLO REFERENCIA / ADAPTAR si hace falta** | Navegador local es fallback. No clicks producto por producto. |
| fixture `lider-search-arroz.json` 2026-07-07 | **SOLO REFERENCIA** | La fixture actual propia reemplaza su uso como contrato vigente. |
| fallback `inStock=true` cuando falta `availabilityStatus` | **NO REUTILIZAR** | La muestra actual demuestra que el campo puede faltar sistemáticamente. |
| `usItemId` como ID de producto | **ADAPTAR** | Sí sirve como `store_product_id`; el bruto nunca es GTIN. Puede derivarse un candidato EAN-13 mediante convenio observado y testeado. |
| `linePrice` / `wasPrice` | **REUTILIZAR/ADAPTAR** | Semántica confirmada en vivo; mapear a `currentPrice` / `normalPrice`. |
| parseo de badges de bundle | **REUTILIZAR/ADAPTAR** | `COMBINA` sigue presente y es explícito. |

## Gate de aprobación Líder

Estado después del v1:

1. **Search actual:** ✅ cerrado — 10/10 búsquedas, 301 productos, sin challenge.
2. **Identidad:** 🟢 casi cerrado — no hay `ean/upc/gtin` explícito, pero la transformación `usItemId -> EAN13 candidato` coincide con múltiples EAN ya confirmados.
3. **Precio:** ✅ precio público y rebaja directa cerrados; bundles `COMBINA` confirmados. Mi Club positivo aún no observado.
4. **Stock:** 🟠 abierto — `availabilityStatus` no sirve en el contrato actual; faltan valores de señales alternativas.
5. **Contexto local:** 🟠 abierto — falta identificar un branch/store id seguro y comprobar que la observación pertenece al contexto seleccionado.
6. **Fixtures sanitizadas:** ✅ fixture compacta actual versionada.
7. **Live smoke:** 🟡 mecanismo browser SSR validado, pero se definirá formalmente después de cerrar stock/contexto.

## Próximo paso

Ejecutar `spikes/lider_stock_context_probe_v2.js`. Hace solo 3 búsquedas (`mantequilla colun`, `coca cola`, `pechuga pollo`), captura señales públicas de stock/ATC y busca únicamente identificadores de tienda seguros. No exporta dirección, código postal, geocoordenadas, cookies, storage, headers, tokens ni el JSON/HTML bruto.
