import type { VatLookupResult } from "./types/app-types";

const PRODUCT_VAT_MAP: Record<string, VatLookupResult> = {
  // 7% VAT - accommodation-related
  // prod_ABC123: { label: "Early Check-in", vatRate: 7 },
  // prod_DEF456: { label: "Late Check-out", vatRate: 7 },

  // 19% VAT - other services
  // prod_GHI789: { label: "Parking", vatRate: 19 },
  // prod_JKL012: { label: "Extra Person", vatRate: 19 },
  // prod_MNO345: { label: "Postage (forgotten items)", vatRate: 19 },
};

export const DEFAULT_VAT_RATE = 19;

export function lookupVat(
  productId: string | null | undefined,
  productName: string | null | undefined,
  productMetadata?: Record<string, string | undefined> | null
): VatLookupResult {
  if (productMetadata?.vat_rate) {
    const rate = Number.parseInt(productMetadata.vat_rate, 10);
    if (!Number.isNaN(rate)) {
      return { label: productName || productId || "Unknown product", vatRate: rate };
    }
  }

  if (productId && PRODUCT_VAT_MAP[productId]) {
    return PRODUCT_VAT_MAP[productId]!;
  }

  const name = String(productName || "").toLowerCase();
  if (name.includes("check-in") || name.includes("checkin") || name.includes("early")) {
    return { label: productName || productId || "Unknown product", vatRate: 7 };
  }
  if (name.includes("check-out") || name.includes("checkout") || name.includes("late")) {
    return { label: productName || productId || "Unknown product", vatRate: 7 };
  }
  if (name.includes("parking")) {
    return { label: productName || productId || "Unknown product", vatRate: 19 };
  }
  if (name.includes("extra") && name.includes("person")) {
    return { label: productName || productId || "Unknown product", vatRate: 19 };
  }
  if (name.includes("postage") || name.includes("post") || name.includes("shipping")) {
    return { label: productName || productId || "Unknown product", vatRate: 19 };
  }

  return { label: productName || productId || "Unknown product", vatRate: DEFAULT_VAT_RATE };
}

export function formatEur(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
