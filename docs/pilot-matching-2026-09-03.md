# Piloto de matching Jumbo ↔ Unimarc — 2026-09-03

Este documento registra únicamente campos públicos de identidad de producto usados para validar el primer matcher. No contiene cookies, tokens, session IDs, direcciones ni material de autenticación.

## Procedencia

- **Jumbo:** spike branch-scoped previamente validado para `jumboclj955`.
- **Unimarc:** captura UI sanitizada de `/catalog/product/search` del 2026-09-03.
- Los precios, promociones y stock quedan fuera de estas pruebas porque **no son señales de identidad**.

## Coincidencias exactas por GTIN/EAN

| Producto | Jumbo ProductId | Jumbo SKU | Unimarc SKU | EAN/GTIN |
|---|---:|---:|---:|---|
| Mantequilla Colun con sal 250 g | 6782 | 6870 | 410 | `7802920203300` |
| Leche Colun entera 1 L | 6609 | 6697 | 2896 | `7802920777542` |
| Azúcar blanca Iansa 1 Kg | 1633 | 1638 | 62 | `7801505231912` |
| Coca-Cola Zero 1,5 L | 498 | 500 | 659 | `7801610350409` |
| Confort Rendiplus 12 un | 129980 | 130279 | 86702 | `7806500508656` |

Los cinco casos deben resolverse como `confirmed / gtin_exact` aun cuando los nombres difieran entre cadenas.

## Control negativo real

La búsqueda `arroz banquete` devolvió productos visualmente compatibles por marca/formato, pero los identificadores observados no son iguales:

- Jumbo: ProductId `1570`, SKU `1574`, EAN `7803110102212`, “Arroz Banquete Premium 1 kg”.
- Unimarc: SKU `32`, EAN `7801420950660`, “Arroz Banquete premium G1 1 Kg”.

El matcher debe **rechazar esta pareja** y no dejar que nombre, marca o volumen sobreescriban un conflicto entre GTIN válidos.

## Resultado esperado del piloto

- 5/5 pares exactos conocidos: confirmados por GTIN.
- 1/1 control negativo: rechazado por GTIN distinto.
- Similaridad textual: puede escalar a revisión, nunca confirmar automáticamente.
