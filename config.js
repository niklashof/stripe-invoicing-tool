/**
 * Shared configuration: product → VAT rate mapping
 *
 * Edit PRODUCT_VAT_MAP with your actual Stripe Product IDs.
 * The keyword fallback handles common naming patterns automatically.
 */

// Map each Stripe Product ID to its VAT rate.
const PRODUCT_VAT_MAP = {
  // 7% VAT – accommodation-related
  // prod_ABC123: { label: "Early Check-in", vatRate: 7 },
  // prod_DEF456: { label: "Late Check-out", vatRate: 7 },

  // 19% VAT – other services
  // prod_GHI789: { label: "Parking", vatRate: 19 },
  // prod_JKL012: { label: "Extra Person", vatRate: 19 },
  // prod_MNO345: { label: "Postage (forgotten items)", vatRate: 19 },
};

const DEFAULT_VAT_RATE = 19;

function lookupVat(productId, productName, productMetadata) {
  // 1. Check product.metadata.vat_rate (set in Stripe dashboard)
  if (productMetadata && productMetadata.vat_rate) {
    const rate = parseInt(productMetadata.vat_rate, 10);
    if (!isNaN(rate)) {
      return { label: productName || productId, vatRate: rate };
    }
  }

  // 2. Hardcoded product ID map
  if (PRODUCT_VAT_MAP[productId]) {
    return PRODUCT_VAT_MAP[productId];
  }

  // 3. Keyword fallback
  const name = (productName || "").toLowerCase();
  if (name.includes("check-in") || name.includes("checkin") || name.includes("early")) {
    return { label: productName, vatRate: 7 };
  }
  if (name.includes("check-out") || name.includes("checkout") || name.includes("late")) {
    return { label: productName, vatRate: 7 };
  }
  if (name.includes("parking")) {
    return { label: productName, vatRate: 19 };
  }
  if (name.includes("extra") && name.includes("person")) {
    return { label: productName, vatRate: 19 };
  }
  if (name.includes("postage") || name.includes("post") || name.includes("shipping")) {
    return { label: productName, vatRate: 19 };
  }

  return { label: productName || productId, vatRate: DEFAULT_VAT_RATE };
}

function formatEur(cents) {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

module.exports = { PRODUCT_VAT_MAP, DEFAULT_VAT_RATE, lookupVat, formatEur };
