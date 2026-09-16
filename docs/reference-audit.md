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

## Reglas del matching implementado

1. GTIN/EAN válido e idéntico: confirmación automática. Para comparar se normaliza a GTIN-14.
2. Códigos retailer observados en el namespace `999000000...` de Unimarc no se usan como identidad GTIN autoritativa.
3. Sin GTIN: atributos determinísticos deben coincidir (marca, familia, variante explícita, cantidad, unidad y `packageCount`).
4. Conflictos determinísticos bloquean el match.
5. Similaridad textual nunca confirma por sí sola: genera revisión humana.
6. El matching no usa precio, promoción ni stock como señal de identidad.

## Evidencia Unimarc validada en septiembre de 2026

- `/catalog/product/search` entrega SKU, EAN, precio, PPUM y promociones.
- `availableQuantity=10000` se trata como sentinel de disponibilidad, no como stock literal.
- `notAvailableProducts` con cantidad 0 es evidencia de no disponibilidad.
- Precio Club debe permanecer separado del precio público.
- Las promociones por cantidad deben conservar mínimo, precio total del bundle y precio efectivo por unidad.
