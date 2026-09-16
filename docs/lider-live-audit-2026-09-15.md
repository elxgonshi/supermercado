# Líder — auditoría live contract 2026-09-15

## Objetivo

Validar el contrato real de Líder antes de integrarlo al catálogo, matching y optimizador. No se asume que endpoints, bloqueo antibot, SSR o campos observados en julio de 2026 sigan vigentes.

## Evidencia actual

### Web pública actual

La web pública de `super.lider.cl` sigue exponiendo contenido de producto server-rendered/indexable en septiembre de 2026. Se observaron páginas actuales con:

- nombre y marca;
- precio vigente;
- precio anterior cuando hay rebaja;
- precio por unidad;
- disponibilidad de retiro/despacho presentada por la UI;
- URL de producto bajo `/ip/.../<id>`;
- especificaciones de producto como contenido neto, variante y un campo `Item` interno.

Ejemplos actuales verificados en la web pública:

- Colun mantequilla con sal 250 g: precio vigente + precio anterior + precio/kg.
- Colun leche entera 1 L: precio vigente + precio/litro.
- Iansa azúcar blanca 1 Kg: aparece en landing actual de búsqueda/SEO de Líder.

Esto corrobora que la capa web actual sigue exponiendo suficiente información para un collector de navegador/SSR. **No prueba por sí solo el contrato interno de `/search?query=` ni su regionalización.**

### Repositorio de referencia `NLACE-COM/mcp-supermercados-cl`

El adapter actual de referencia usa:

`GET https://super.lider.cl/search?query={query}`

El parser busca `__NEXT_DATA__` y nodos `__typename: "Product"` con campos como `usItemId`, `name`, `brand`, `canonicalUrl`, `availabilityStatus` y `priceInfo` (`linePrice`, `wasPrice`, `unitPrice`, `memberPriceString`). El último commit que declara validación contra sitio real es del **2026-07-09** y reportó ~46 productos usando Chrome real.

La misma fuente documenta que el HTTP plano quedó bloqueado por PerimeterX/F5 el 2026-07-08 y que el fallback operativo es navegador real. Esa evidencia es histórica, no se trata como verdad permanente.

## Hallazgo crítico de identidad

**`usItemId` NO se tratará como EAN/GTIN.**

Los identificadores visibles actualmente en URLs de productos Líder no pasan checksum GTIN en ejemplos reales. Por lo tanto:

- `usItemId` / id de URL = `store_product_id` candidato;
- `gtin` queda `null` salvo que el SSR actual exponga explícitamente `ean`, `upc`, `gtin` u otro identificador validable;
- el matching no puede confirmar por `usItemId` contra Jumbo/Unimarc.

Esto evita una falsa equivalencia particularmente peligrosa porque el matching canónico da prioridad máxima al GTIN.

## Clasificación de reutilización

| Parte upstream | Clasificación | Decisión |
|---|---|---|
| `src/adapters/lider.ts` — idea general de parser | **ADAPTAR** | La estructura conceptual es útil, pero se revalida en sitio actual y no se importará su semántica sin evidencia nueva. |
| `src/adapters/nextData.ts` | **REUTILIZAR/ADAPTAR** | La extracción tolerante de `__NEXT_DATA__` frente a orden de atributos es una solución simple y robusta. Implementación propia o atribución MIT si se copia código. |
| `src/adapters/playwrightBridge.ts` | **SOLO REFERENCIA / ADAPTAR si hace falta** | Navegador local es fallback, no primera opción. No automatizar clicks producto por producto. |
| fixture `lider-search-arroz.json` 2026-07-07 | **SOLO REFERENCIA** | Sirve para entender forma histórica; no vale como contrato current/live. |
| tratamiento `inStock = availabilityStatus === IN_STOCK` con fallback true | **NO REUTILIZAR tal cual** | Ausencia de campo debe resultar `UNKNOWN`, no `AVAILABLE`. |
| `usItemId` como `Product.id` | **ADAPTAR** | Puede servir como `store_product_id`, nunca como GTIN sin validación explícita. |

## Gate de aprobación Líder

Antes de habilitar `lider` en el optimizador deben cerrarse estos puntos:

1. **Search actual:** mismas 10 búsquedas del piloto Jumbo/Unimarc, usando navegador real si HTTP estructurado no es suficiente.
2. **Identidad:** determinar si el SSR actual trae `ean/upc/gtin`; si no, matching determinístico + revisión humana cuando corresponda.
3. **Precio:** `normal`, `current`, socio/Mi Club si existe y promociones por cantidad.
4. **Stock:** mapear solo evidencia real a `AVAILABLE`, `UNAVAILABLE`, `UNKNOWN`; no inventar disponibilidad.
5. **Contexto local:** verificar cómo afecta tienda/dirección a precio y stock sin guardar dirección ni tokens.
6. **Fixtures sanitizadas:** crear fixtures propias actuales para unit/contract tests.
7. **Live smoke:** pequeño, local, con rate limit y sin loops/reintentos agresivos.

## Próximo paso

Ejecutar `spikes/lider_browser_probe_v1.js` en un navegador real con la tienda/dirección normal ya seleccionada. El probe realiza las 10 búsquedas secuencialmente mediante navegación same-origin en iframes, lee únicamente SSR público y exporta un JSON sanitizado. Si Líder entrega challenge/bloqueo, el probe lo registra y **no intenta evadirlo ni reintenta**.
