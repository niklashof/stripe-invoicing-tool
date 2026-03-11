import { lookupVat } from "./config";
import type {
  ExportRange,
  LineItemReport,
  LineItemRow,
  StripeClientLike,
  StripeLineItemLike,
  StripeSessionLike,
  VatBucket,
  VatBuckets,
} from "./types/app-types";

export const MAX_EXPORT_RANGE_DAYS = 366;

function parseIsoDate(value: string | undefined, fieldName: string): Date {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
  }

  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`${fieldName} is not a valid date`);
  }

  return date;
}

export function buildUnixDateRange(fromDate: string | undefined, toDate: string | undefined): ExportRange {
  const from = parseIsoDate(fromDate, "from");
  const to = parseIsoDate(toDate, "to");

  if (from > to) {
    throw new Error("from must be on or before to");
  }

  const fromTimestamp = Math.floor(from.getTime() / 1000);
  const exclusiveTo = new Date(to);
  exclusiveTo.setDate(exclusiveTo.getDate() + 1);
  const toTimestamp = Math.floor(exclusiveTo.getTime() / 1000);
  const rangeDays = Math.round((exclusiveTo.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));

  if (rangeDays > MAX_EXPORT_RANGE_DAYS) {
    throw new Error(`Date range must not exceed ${MAX_EXPORT_RANGE_DAYS} days`);
  }

  return { from: fromTimestamp, to: toTimestamp };
}

export async function listCompletedSessions(
  stripeClient: StripeClientLike,
  range: ExportRange
): Promise<StripeSessionLike[]> {
  const sessions: StripeSessionLike[] = [];
  for await (const session of stripeClient.checkout.sessions.list({
    created: { gte: range.from, lt: range.to },
    status: "complete",
    limit: 100,
    expand: ["data.line_items", "data.line_items.data.price.product"],
  })) {
    sessions.push(session);
  }
  return sessions;
}

export async function getExpandedLineItems(
  stripeClient: StripeClientLike,
  session: StripeSessionLike
): Promise<StripeLineItemLike[]> {
  const lineItems = session.line_items?.data || [];
  const hasCompleteLineItems =
    lineItems.length > 0 &&
    !session.line_items?.has_more &&
    lineItems.every((item) => typeof item.price?.product === "object");

  if (hasCompleteLineItems) {
    return lineItems;
  }

  const fetched = await stripeClient.checkout.sessions.listLineItems(session.id, {
    limit: 100,
    expand: ["data.price.product"],
  });
  return fetched.data;
}

export async function fetchCheckoutSessionDetails(
  stripeClient: StripeClientLike,
  sessionId: string
): Promise<StripeSessionLike> {
  return stripeClient.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
}

function buildLineItemRow(session: StripeSessionLike, item: StripeLineItemLike): LineItemRow {
  const product = item.price?.product;
  const productId = typeof product === "string" ? product : product?.id;
  const productName = typeof product === "object" ? product?.name : null;
  const productMetadata = typeof product === "object" ? product?.metadata : null;
  const { label, vatRate } = lookupVat(productId, productName, productMetadata);

  const grossCents = item.amount_total;
  const netCents = Math.round(grossCents / (1 + vatRate / 100));
  const vatCents = grossCents - netCents;

  return {
    date: new Date(session.created * 1000).toISOString().slice(0, 10),
    sessionId: session.id,
    customerEmail: session.customer_details?.email || "",
    product: label,
    productId: productId || null,
    vatRate,
    quantity: item.quantity,
    grossCents,
    netCents,
    vatCents,
  };
}

export async function buildLineItemReport(
  stripeClient: StripeClientLike,
  range: ExportRange
): Promise<LineItemReport> {
  const sessions = await listCompletedSessions(stripeClient, range);
  const rows: LineItemRow[] = [];
  const buckets: VatBuckets = {};

  for (const session of sessions) {
    const lineItems = await getExpandedLineItems(stripeClient, session);

    for (const item of lineItems) {
      const row = buildLineItemRow(session, item);
      rows.push(row);

      if (!buckets[row.vatRate]) {
        buckets[row.vatRate] = { gross: 0, net: 0, vat: 0, count: 0, byProduct: {} };
      }
      const bucket = buckets[row.vatRate] as VatBucket;
      bucket.gross += row.grossCents;
      bucket.net += row.netCents;
      bucket.vat += row.vatCents;
      bucket.count += row.quantity;

      if (!bucket.byProduct[row.product]) {
        bucket.byProduct[row.product] = { gross: 0, net: 0, vat: 0, count: 0 };
      }
      const productBucket = bucket.byProduct[row.product]!;
      productBucket.gross += row.grossCents;
      productBucket.net += row.netCents;
      productBucket.vat += row.vatCents;
      productBucket.count += row.quantity;
    }
  }

  return { buckets, rows, sessions };
}

function neutralizeSpreadsheetFormula(value: unknown): string {
  const normalized = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[\s]*[=+\-@]/.test(normalized)) {
    return `'${normalized}`;
  }
  return normalized;
}

function escapeCsvCell(value: unknown): string {
  const safeValue = neutralizeSpreadsheetFormula(value).replace(/"/g, "\"\"");
  return `"${safeValue}"`;
}

function formatEurDot(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function buildLineItemCsv(rows: LineItemRow[]): string {
  const csvHeader = [
    "Datum",
    "Session-ID",
    "E-Mail",
    "Produkt",
    "Produkt-ID",
    "USt-%",
    "Anzahl",
    "Brutto (EUR)",
    "Netto (EUR)",
    "USt (EUR)",
  ].join(";");

  const csvRows = rows.map((row) =>
    [
      escapeCsvCell(row.date),
      escapeCsvCell(row.sessionId),
      escapeCsvCell(row.customerEmail),
      escapeCsvCell(row.product),
      escapeCsvCell(row.productId || ""),
      row.vatRate,
      row.quantity,
      formatEurDot(row.grossCents),
      formatEurDot(row.netCents),
      formatEurDot(row.vatCents),
    ].join(";")
  );

  return [csvHeader, ...csvRows].join("\n");
}
