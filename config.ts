import type { VatLookupResult } from "./types/app-types";

export const DEFAULT_VAT_RATE = 19;

function getProductLabel(productId: string | null | undefined, productName: string | null | undefined): string {
  return productName || productId || "Unknown product";
}

function getProductReference(
  productId: string | null | undefined,
  productName: string | null | undefined
): string {
  const label = getProductLabel(productId, productName);
  return productId ? `"${label}" (${productId})` : `"${label}"`;
}

export function lookupVat(
  productId: string | null | undefined,
  productName: string | null | undefined,
  productMetadata?: Record<string, string | undefined> | null
): VatLookupResult {
  const label = getProductLabel(productId, productName);
  const rawRate = productMetadata?.vat_rate?.trim();

  if (rawRate) {
    if (/^\d+$/.test(rawRate)) {
      const rate = Number.parseInt(rawRate, 10);
      return { label, vatRate: rate, source: "metadata" };
    }
    return {
      label,
      vatRate: DEFAULT_VAT_RATE,
      source: "default",
      warning: `VAT metadata invalid for ${getProductReference(productId, productName)}: vat_rate="${rawRate}". Defaulted to ${DEFAULT_VAT_RATE}%.`,
    };
  }

  return {
    label,
    vatRate: DEFAULT_VAT_RATE,
    source: "default",
    warning: `VAT metadata missing for ${getProductReference(productId, productName)}. Defaulted to ${DEFAULT_VAT_RATE}%.`,
  };
}

export function formatEur(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
