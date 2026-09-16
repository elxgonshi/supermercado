# Optimizador v1 — Jumbo + Unimarc

## Alcance

Este primer optimizador trabaja únicamente sobre productos exactos ya vinculados al catálogo canónico. No busca productos, no hace fuzzy matching y no intenta sustituir necesidades.

Entrada conceptual:

`BasketItem -> CanonicalProduct -> StoreProduct -> PriceObservation -> Optimizer`

El objetivo es minimizar el costo de la canasta bajo un máximo de supermercados, manteniendo por separado la evidencia de precio, promociones, membresía y disponibilidad.

Las únicas cadenas admitidas por esta versión son **Jumbo y Unimarc**. Si recibe una oferta de Líder, falla explícitamente en vez de asumir que su semántica de precio, promoción y stock ya fue validada.

## Semántica de precio

- `normalPrice`: precio de lista observado.
- `currentPrice`: precio público vigente; tiene prioridad sobre `normalPrice`.
- `memberPrice`: precio de socio/Club; nunca reemplaza silenciosamente al precio público.
- `unitPrice`: dato informativo normalizado; el total del ítem se calcula desde precios reales del producto retail.
- promociones por cantidad se modelan explícitamente con cantidad requerida y precio total del bundle.

Cuando existen descuento web y bundle Club simultáneamente, ambos se conservan. Para unidades fuera del bundle se usa el mejor precio unitario elegible.

## Repetibilidad de promociones

La repetibilidad nunca se inventa:

- `repeatable`: puede repetirse hasta cubrir la cantidad o alcanzar `maxApplications`.
- `single`: una sola aplicación.
- `unknown`: una sola aplicación por criterio conservador.
- `maxApplications`: si la fuente entrega un límite explícito, manda ese límite.

Ejemplo: precio unitario $1.690 y Club `2 x $2.000` con repetibilidad desconocida.

- 2 unidades con Club: $2.000.
- 4 unidades con Club: $2.000 + 2 × $1.690 = $5.380.
- Solo si se confirma que la promo es repetible: 4 unidades = $4.000.

## Stock

- `AVAILABLE`: elegible.
- `UNAVAILABLE`: nunca elegible.
- `UNKNOWN`: excluido por defecto.
- `allow_unknown`: política explícita para escenarios exploratorios; el plan queda marcado con ítems de disponibilidad incierta.

Los sentinels observados como `10000`/`99999` no se convierten en cantidad física de stock.

## Sucursales

El precio puede depender de sucursal. Una corrida del optimizador no puede mezclar dos `branchId` distintos de una misma cadena. El caller debe preseleccionar un único contexto de sucursal por supermercado.

## Historial

`PriceObservation` se modela como valor inmutable. Una nueva lectura genera otra observación; no se modifica la anterior. Si la entrada contiene varias observaciones del mismo `storeProductId` y sucursal, el optimizador usa la más reciente por `observedAt`.

## Salidas

El resultado expone:

- plan para cada supermercado por separado;
- mejor plan usando hasta 1 supermercado;
- mejor plan usando hasta 2 supermercados;
- mejor plan sin límite entre las cadenas disponibles;
- plan bajo `maxStores` si el usuario impone un máximo;
- ahorro marginal al permitir una tienda adicional;
- ítems sin una oferta elegible.

El ahorro marginal se muestra como dato. El motor no decide que una segunda tienda "vale la pena" por un ahorro pequeño; esa decisión de UX se hará después incorporando fricción, despacho, mínimos y preferencias.

## Fuera de alcance v1

- Líder: cualquier oferta de esa cadena se rechaza hasta validar su adapter y contrato.
- despacho y costo fijo por tienda;
- mínimos de compra;
- tarjetas bancarias;
- promociones cruzadas entre productos;
- sustituciones por necesidad;
- carrito automático;
- decisión UX sobre cuánto ahorro justifica visitar otra tienda.
