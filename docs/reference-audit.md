# Auditoría de reutilización — NLACE-COM/mcp-supermercados-cl

Repositorio de referencia: `NLACE-COM/mcp-supermercados-cl` (licencia MIT).

Esta base no copia código del proyecto de referencia. Se reutilizan conceptos y aprendizajes técnicos, con implementación propia.

| Parte | Clasificación | Decisión |
|---|---|---|
| `src/core/normalize.ts` | ADAPTAR | Útil como referencia para normalización chilena de texto/unidades, pero nuestro catálogo necesita cantidad base, `packageCount` y matching exacto entre cadenas. |
| `src/core/matching.ts` | SOLO REFERENCIA | Resuelve query textual contra nombres; no identifica identidad de producto entre supermercados. |
| `src/core/types.ts` | ADAPTAR | La separación de producto/precio es útil, pero nuestro modelo separa `CanonicalProduct` y `StoreProduct`. |
| `src/adapters/unimarc.ts` | SOLO REFERENCIA | El endpoint y campos ayudan como referencia; no reutilizar su semántica `inStock: true` ni tratar el precio Club como precio público. |
| Fixtures históricas de Unimarc | SOLO REFERENCIA | Útiles para comprender forma de respuesta; los tests del proyecto deben usar fixtures propias capturadas y sanitizadas. |
| `src/core/cheapestBasket.ts` | SOLO REFERENCIA | La idea de comparar canasta única vs. compra repartida es útil, pero ese código elige por precio/PPUM sobre candidatos de búsqueda. Nuestro optimizador solo consume productos ya vinculados a un `CanonicalProduct`, modela cantidad, membresía, bundles y stock. |
| `src/core/compare.ts` | SOLO REFERENCIA | Su aislamiento por cadena y resultado parcial son útiles para collectors futuros, pero su comparabilidad textual no sustituye matching de identidad ni debe alimentar directamente el optimizador. |

## Reglas del matching implementado

1. GTIN/EAN válido e idéntico: confirmación automática. Para comparar se normaliza a GTIN-14.
2. Códigos retailer observados en el namespace `999000000...` de Unimarc no se usan como identidad GTIN autoritativa.
3. GTIN all-zero se rechaza como placeholder aunque el checksum matemático sea válido.
4. Sin GTIN: atributos determinísticos deben coincidir (marca, familia, variante explícita, cantidad, unidad y `packageCount`).
5. Conflictos determinísticos bloquean el match.
6. Similaridad textual nunca confirma por sí sola: genera revisión humana.
7. El matching no usa precio, promoción ni stock como señal de identidad.

## Evidencia Unimarc validada en septiembre de 2026

- `/catalog/product/search` entrega SKU, EAN, precio, PPUM y promociones.
- `availableQuantity=10000` se trata como sentinel de disponibilidad, no como stock literal.
- `notAvailableProducts` con cantidad 0 es evidencia de no disponibilidad.
- Precio Club debe permanecer separado del precio público.
- Las promociones por cantidad deben conservar mínimo, precio total del bundle y precio efectivo por unidad.

## Reglas del optimizador v1

1. Solo optimiza productos exactos ya asociados a `canonicalProductId`; no hace matching durante la optimización.
2. Usa observaciones de precio inmutables y selecciona la más reciente cuando recibe historial del mismo `storeProductId` y sucursal.
3. Nunca mezcla dos sucursales/contextos de una misma cadena en una sola corrida.
4. `UNAVAILABLE` se excluye. `UNKNOWN` se excluye por defecto y solo entra bajo una política explícita.
5. Precio público: `currentPrice` con fallback a `normalPrice`.
6. Precio socio se usa solo cuando la cadena está declarada en `memberStores` y realmente mejora el costo.
7. Bundle con repetibilidad desconocida se aplica como máximo una vez; solo `repeatable` permite repetirlo automáticamente, salvo límite explícito observado.
8. El optimizador calcula el mejor plan por máximo de tiendas y expone ahorro marginal. No concluye que abrir otra tienda sea conveniente solo porque el total sea unos pesos menor.
