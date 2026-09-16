export const STORE_IDS = ["jumbo", "unimarc", "lider"] as const;
export type StoreId = (typeof STORE_IDS)[number];

export const BASE_UNITS = ["g", "ml", "un"] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export interface CanonicalProduct {
  id: string;
  brand: string;
  family: string;
  variant: string | null;
  quantity: number | null;
  unit: BaseUnit | null;
  packageCount: number;
  category: string | null;
  gtin: string | null;
}

export interface StoreProduct {
  store: StoreId;
  storeProductId: string;
  sku: string | null;
  gtin: string | null;
  rawName: string;
  brand: string | null;
  family: string | null;
  variant: string | null;
  quantity: number | null;
  unit: BaseUnit | null;
  packageCount: number | null;
  category: string | null;
  url: string | null;
  imageUrl: string | null;
  canonicalProductId: string | null;
}

export type MatchDecision =
  | {
      kind: "confirmed";
      strategy: "gtin_exact" | "deterministic";
      reasons: string[];
    }
  | {
      kind: "review";
      strategy: "textual_review";
      score: number;
      reasons: string[];
    }
  | {
      kind: "no_match";
      strategy: "incompatible" | "insufficient";
      reasons: string[];
    };

const SPACE_RE = /\s+/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(NON_ALNUM_RE, " ")
    .replace(SPACE_RE, " ")
    .trim();
}

export function normalizeGtin(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return isValidGtin(digits) ? digits : null;
}

export function isValidGtin(gtin: string): boolean {
  if (!/^\d+$/.test(gtin) || ![8, 12, 13, 14].includes(gtin.length)) return false;
  const digits = [...gtin].map(Number);
  const check = digits.pop();
  if (check === undefined) return false;

  let sum = 0;
  for (let i = digits.length - 1, position = 1; i >= 0; i--, position++) {
    const digit = digits[i];
    if (digit === undefined) return false;
    sum += digit * (position % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

export interface ParsedPackSize {
  quantity: number;
  unit: BaseUnit;
  packageCount: number;
}

const DECIMAL = "(\\d+(?:[.,]\\d+)?)";
const UNIT = "(kg|kilos?|g|grs?|gramos?|l|lt|litros?|ml|cc|un|u|unidad(?:es)?)";

function toBaseQuantity(rawQuantity: string, rawUnit: string): Pick<ParsedPackSize, "quantity" | "unit"> | null {
  const quantity = Number(rawQuantity.replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const unit = normalizeText(rawUnit);

  if (["kg", "kilo", "kilos"].includes(unit)) return { quantity: Math.round(quantity * 1000), unit: "g" };
  if (["g", "gr", "grs", "gramo", "gramos"].includes(unit)) return { quantity: Math.round(quantity), unit: "g" };
  if (["l", "lt", "litro", "litros"].includes(unit)) return { quantity: Math.round(quantity * 1000), unit: "ml" };
  if (["ml", "cc"].includes(unit)) return { quantity: Math.round(quantity), unit: "ml" };
  if (["un", "u", "unidad", "unidades"].includes(unit)) return { quantity: Math.round(quantity), unit: "un" };
  return null;
}

export function parsePackSize(rawName: string): ParsedPackSize | null {
  if (rawName.includes("+")) return null;
  const text = rawName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SPACE_RE, " ")
    .trim();

  const explicitPack = text.match(new RegExp(`\\b(\\d+)\\s*(?:un|u|unidad(?:es)?)\\s*(?:de|x)\\s*${DECIMAL}\\s*${UNIT}\\b`, "i"));
  if (explicitPack) {
    const packageCount = Number(explicitPack[1]);
    const base = toBaseQuantity(explicitPack[2] ?? "", explicitPack[3] ?? "");
    if (Number.isInteger(packageCount) && packageCount > 0 && base) return { ...base, packageCount };
  }

  const compactPack = text.match(new RegExp(`\\b(\\d+)\\s*x\\s*${DECIMAL}\\s*${UNIT}\\b`, "i"));
  if (compactPack) {
    const packageCount = Number(compactPack[1]);
    const base = toBaseQuantity(compactPack[2] ?? "", compactPack[3] ?? "");
    if (Number.isInteger(packageCount) && packageCount > 0 && base) return { ...base, packageCount };
  }

  const single = text.match(new RegExp(`${DECIMAL}\\s*${UNIT}\\s*$`, "i"));
  if (single) {
    const base = toBaseQuantity(single[1] ?? "", single[2] ?? "");
    if (base) return { ...base, packageCount: 1 };
  }

  return null;
}

export function enrichPackSize(product: StoreProduct): StoreProduct {
  if (product.quantity !== null && product.unit !== null && product.packageCount !== null) return product;
  const parsed = parsePackSize(product.rawName);
  if (!parsed) return product;
  return {
    ...product,
    quantity: product.quantity ?? parsed.quantity,
    unit: product.unit ?? parsed.unit,
    packageCount: product.packageCount ?? parsed.packageCount,
  };
}

const STOPWORDS = new Set([
  "de", "del", "la", "las", "el", "los", "con", "sin", "para", "por", "y", "o",
  "un", "una", "unidad", "unidades", "pack", "pote", "botella", "lata", "desechable",
]);

function normalizedOptional(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  return normalized || null;
}

function comparableTokens(value: string): Set<string> {
  const normalized = normalizeText(value);
  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => !/^\d+(?:[.,]\d+)?$/.test(token))
    .filter((token) => !["g", "gr", "kg", "ml", "cc", "l", "lt"].includes(token));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function hardConflictReasons(a: StoreProduct, b: StoreProduct): string[] {
  const reasons: string[] = [];
  const brandA = normalizedOptional(a.brand);
  const brandB = normalizedOptional(b.brand);
  const variantA = normalizedOptional(a.variant);
  const variantB = normalizedOptional(b.variant);

  if (brandA && brandB && brandA !== brandB) reasons.push("brand differs");
  if (variantA && variantB && variantA !== variantB) reasons.push("variant differs");

  if (a.unit && b.unit && a.unit === b.unit && a.quantity !== null && b.quantity !== null && a.quantity !== b.quantity) {
    reasons.push("quantity differs");
  }
  if (a.unit && b.unit && a.unit !== b.unit && a.quantity !== null && b.quantity !== null) {
    reasons.push("unit differs");
  }
  if (a.packageCount !== null && b.packageCount !== null && a.packageCount !== b.packageCount) {
    reasons.push("package count differs");
  }
  return reasons;
}

function deterministicMatch(a: StoreProduct, b: StoreProduct): boolean {
  const brandA = normalizedOptional(a.brand);
  const brandB = normalizedOptional(b.brand);
  const familyA = normalizedOptional(a.family);
  const familyB = normalizedOptional(b.family);
  const variantA = normalizedOptional(a.variant);
  const variantB = normalizedOptional(b.variant);

  if (!brandA || !brandB || brandA !== brandB) return false;
  if (!familyA || !familyB || familyA !== familyB) return false;
  if (a.quantity === null || b.quantity === null || a.quantity !== b.quantity) return false;
  if (!a.unit || !b.unit || a.unit !== b.unit) return false;
  if (a.packageCount === null || b.packageCount === null || a.packageCount !== b.packageCount) return false;

  if ((variantA === null) !== (variantB === null)) return false;
  if (variantA && variantB && variantA !== variantB) return false;
  return true;
}

export interface MatchOptions {
  reviewThreshold?: number;
}

export function matchStoreProducts(
  leftInput: StoreProduct,
  rightInput: StoreProduct,
  options: MatchOptions = {},
): MatchDecision {
  const left = enrichPackSize(leftInput);
  const right = enrichPackSize(rightInput);
  const reviewThreshold = options.reviewThreshold ?? 0.72;

  const leftGtin = normalizeGtin(left.gtin);
  const rightGtin = normalizeGtin(right.gtin);

  if (leftGtin && rightGtin) {
    if (leftGtin === rightGtin) {
      return {
        kind: "confirmed",
        strategy: "gtin_exact",
        reasons: ["valid GTIN is identical"],
      };
    }
    return {
      kind: "no_match",
      strategy: "incompatible",
      reasons: ["valid GTIN differs"],
    };
  }

  const conflicts = hardConflictReasons(left, right);
  if (conflicts.length > 0) {
    return { kind: "no_match", strategy: "incompatible", reasons: conflicts };
  }

  if (deterministicMatch(left, right)) {
    return {
      kind: "confirmed",
      strategy: "deterministic",
      reasons: ["brand, family, variant, quantity, unit and package count agree"],
    };
  }

  const score = jaccard(comparableTokens(left.rawName), comparableTokens(right.rawName));
  if (score >= reviewThreshold) {
    return {
      kind: "review",
      strategy: "textual_review",
      score,
      reasons: ["text is similar but deterministic identity is incomplete"],
    };
  }

  return {
    kind: "no_match",
    strategy: "insufficient",
    reasons: ["not enough deterministic evidence for exact-product identity"],
  };
}
