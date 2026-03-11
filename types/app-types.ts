import type { RequestHandler } from "express";

export interface Account {
  slug: string;
  name: string;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  slackWebhookUrl: string | null;
}

export interface AccountUpdates {
  name?: string;
  stripeSecretKey?: string | null;
  stripeWebhookSecret?: string | null;
  slackWebhookUrl?: string | null;
}

export interface SafeUser {
  id: string;
  username: string;
}

export interface StoredUser extends SafeUser {
  passwordHash: string;
  createdAt: string;
}

export interface VatLookupResult {
  label: string;
  vatRate: number;
}

export interface ExportRange {
  from: number;
  to: number;
}

export interface StripeProductLike {
  id: string;
  name?: string | null;
  metadata?: Record<string, string | undefined> | null;
}

export interface StripeLineItemLike {
  amount_total: number;
  quantity: number;
  price?: {
    product?: string | StripeProductLike | null;
  } | null;
}

export interface StripeSessionLike {
  id: string;
  created: number;
  customer_details?: {
    email?: string | null;
  } | null;
  payment_intent?: string | { id: string } | null;
  line_items?: {
    data: StripeLineItemLike[];
    has_more?: boolean;
  } | null;
}

export interface StripeClientLike {
  webhooks: {
    constructEvent: (
      payload: Buffer,
      signature: string | string[] | undefined,
      secret: string
    ) => CheckoutEvent;
  };
  checkout: {
    sessions: {
      list: (params: unknown) => AsyncIterable<StripeSessionLike>;
      listLineItems: (sessionId: string, params: unknown) => Promise<{ data: StripeLineItemLike[] }>;
      retrieve: (sessionId: string, params?: unknown) => Promise<StripeSessionLike>;
    };
  };
}

export type StripeFactory = (secretKey: string) => StripeClientLike;

export interface CheckoutEvent {
  type: string;
  data?: {
    object?: {
      id?: string;
    };
  };
}

export interface LineItemRow {
  date: string;
  sessionId: string;
  customerEmail: string;
  product: string;
  productId: string | null;
  vatRate: number;
  quantity: number;
  grossCents: number;
  netCents: number;
  vatCents: number;
}

export interface ProductBucket {
  gross: number;
  net: number;
  vat: number;
  count: number;
}

export interface VatBucket extends ProductBucket {
  byProduct: Record<string, ProductBucket>;
}

export type VatBuckets = Record<number, VatBucket>;

export interface LineItemReport {
  buckets: VatBuckets;
  rows: LineItemRow[];
  sessions: StripeSessionLike[];
}

export interface ProcessedSessionsState {
  [accountSlug: string]: Record<string, { processedAt: string }>;
}

export interface SerializedAccount {
  slug: string;
  name: string;
  webhookPath: string;
  hasStripeKey: boolean;
  stripeSecretKeyMasked: string | null;
  hasWebhookSecret: boolean;
  stripeWebhookSecretMasked: string | null;
  hasSlackUrl: boolean;
  slackWebhookUrlMasked: string | null;
}

export interface CreateApiRouterOptions {
  disableWebSetup?: boolean;
  stripeFactory?: StripeFactory;
}

export interface CreateAppOptions extends CreateApiRouterOptions {
  sessionSecret?: string;
  allowUnsignedWebhooks?: boolean;
  trustProxy?: string | number | boolean;
  loginLimiter?: RequestHandler;
  setupLimiter?: RequestHandler;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
