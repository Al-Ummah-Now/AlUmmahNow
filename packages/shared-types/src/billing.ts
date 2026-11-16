/**
 * Payments for creator tiers (wiki AUN-SUBS, Epic 27.6/27.7, decisions T1, T2, P1).
 *
 * Creator tiers ARE the plans: a paid subscription assigns a tier with source
 * 'subscription' (creator-tiers.ts). Payments are off by default. While no
 * provider is enabled, /upgrade stays the request form (tier-requests.ts).
 * When an admin enables a provider, tiers that have prices and sell as 'auto'
 * show prices and a Subscribe button. Tiers set to 'request' always stay
 * request-only.
 *
 * Providers sit behind one interface (api-videos lib/billing/provider.ts).
 * Never Stripe (T2). The shipped adapters are Paddle (a global merchant of
 * record from the S16 shortlist) and PayGood. 'manual' is the always-present
 * provider (T2) that records admin comps. 'fake' is the test double
 * (QA/local only, never production): it moves no money.
 *
 * Credentials are entered in the videos admin. They are written to
 * Cloudflare Secrets Store and never shown back: the admin sees only whether
 * each one is set, when and by whom. Videos-side data (search D1,
 * migrations/search/0040), never Auth RBAC.
 */

/** Providers an admin can configure. 'fake' exists only where PAYMENTS_FAKE_PROVIDER is on (never production). */
export const PAYMENT_PROVIDER_IDS = ['paddle', 'paygood', 'fake'] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDER_IDS)[number];

/** Every provider a subscription can come from: the configurable ones plus the manual (admin comp) provider. */
export type BillingProviderId = PaymentProviderId | 'manual';

export const PAYMENT_MODES = ['test', 'live'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const BILLING_PERIODS = ['month', 'year'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];


/** Secret credential fields, per mode. Written to Secrets Store, never read back by the admin. */
export const PAYMENT_CREDENTIAL_FIELDS = ['apiKey', 'webhookSecret'] as const;
export type PaymentCredentialField = (typeof PAYMENT_CREDENTIAL_FIELDS)[number];

/** A non-secret provider setting, shown back to the admin. */
export interface PaymentSettingSpec {
  key: string;
  /** Kept per mode (test/live): a different value in each */
  perMode: boolean;
  /** Free text with an optional pattern, or a choice from `options` */
  kind: 'text' | 'choice';
  options?: readonly string[];
  pattern?: string;
  maxLength?: number;
  required: boolean;
}

export interface PaymentProviderSpec {
  id: PaymentProviderId;
  /** Brand name (not translated) */
  name: string;
  /** ISO 4217 codes the provider can charge; null = any code the provider supports (checked when prices sync) */
  currencies: readonly string[] | null;
  /** The provider computes and remits sales tax / VAT (merchant of record) */
  merchantOfRecord: boolean;
  /** The provider hosts a portal where the customer manages payment details */
  customerPortal: boolean;
  /** Refunds of part of a payment */
  partialRefunds: boolean;
  /** Cancel at the end of the paid period (otherwise cancel ends billing at once; the tier stays until the period ends) */
  cancelAtPeriodEnd: boolean;
  settings: readonly PaymentSettingSpec[];
  /** Developer docs (shown in the admin next to the credential fields) */
  docsUrl: string;
}

/** Paddle tax categories (Paddle Billing product `tax_category`). */
export const PADDLE_TAX_CATEGORIES = ['standard', 'digital-goods', 'saas', 'ebooks', 'implementation-services', 'professional-services', 'training-services', 'website-hosting'] as const;
/** Paddle price `tax_mode`. */
export const PADDLE_TAX_MODES = ['account_setting', 'internal', 'external'] as const;

export const PAYMENT_PROVIDERS: Readonly<Record<PaymentProviderId, PaymentProviderSpec>> = {
  paddle: {
    id: 'paddle',
    name: 'Paddle',
    currencies: null,
    merchantOfRecord: true,
    customerPortal: true,
    partialRefunds: true,
    cancelAtPeriodEnd: true,
    docsUrl: 'https://developer.paddle.com/api-reference/overview',
    settings: [
      // Paddle.js client-side token (public; opens the checkout on the videos site)
      { key: 'clientToken', perMode: true, kind: 'text', pattern: '^(test|live)_[A-Za-z0-9]{10,80}$', maxLength: 90, required: true },
      { key: 'taxCategory', perMode: false, kind: 'choice', options: PADDLE_TAX_CATEGORIES, required: true },
      { key: 'taxMode', perMode: false, kind: 'choice', options: PADDLE_TAX_MODES, required: true },
    ],
  },
  paygood: {
    id: 'paygood',
    name: 'PayGood',
    currencies: ['USD', 'CAD'],
    merchantOfRecord: false,
    customerPortal: false,
    partialRefunds: true,
    cancelAtPeriodEnd: false,
    docsUrl: 'https://docs.paygood.com/introduction',
    settings: [
      { key: 'merchantId', perMode: true, kind: 'text', pattern: '^mer_[A-Za-z0-9]{6,60}$', maxLength: 64, required: true },
    ],
  },
  fake: {
    id: 'fake',
    name: 'Test provider',
    currencies: ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'CAD'],
    merchantOfRecord: false,
    customerPortal: false,
    partialRefunds: true,
    cancelAtPeriodEnd: true,
    docsUrl: 'https://github.com/Al-Ummah-Now/AlUmmahNow/blob/main/docs/features/payments.md',
    settings: [],
  },
};

/** Seller details for invoices and tax (providers that are not the merchant of record need them). */
export interface BillingTaxSettings {
  /** Legal name on receipts */
  sellerName: string | null;
  /** Registered address (multi-line) */
  sellerAddress: string | null;
  /** ISO 3166-1 alpha-2 */
  sellerCountry: string | null;
  /** VAT / GST / tax registration number */
  taxId: string | null;
  /** Prices entered here already include tax */
  pricesIncludeTax: boolean;
  /** Tax rate shown to buyers when the provider is not the merchant of record (percent, 0–100); null = none shown */
  taxRatePercent: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_BILLING_TAX: BillingTaxSettings = {
  sellerName: null,
  sellerAddress: null,
  sellerCountry: null,
  taxId: null,
  pricesIncludeTax: true,
  taxRatePercent: null,
  updatedAt: null,
  updatedBy: null,
};

export const BILLING_TEXT_LIMITS = { sellerName: 200, sellerAddress: 500, taxId: 50 } as const;

/** When and by whom a credential was last written; never its value. */
export interface CredentialStatus {
  setAt: string;
  setBy: string;
}

/** A provider as the admin sees it. */
export interface PaymentProviderConfig {
  id: PaymentProviderId;
  enabled: boolean;
  mode: PaymentMode;
  /** Non-secret settings: per-mode keys are stored as `<key>.<mode>` */
  settings: Record<string, string>;
  /** credentials[field][mode]: set or not (never the value) */
  credentials: Record<PaymentCredentialField, Partial<Record<PaymentMode, CredentialStatus>>>;
  /** The URL to register in the provider's dashboard for webhooks */
  webhookUrl: string;
  /** What is still missing before the provider can be enabled in its current mode (empty: ready) */
  missing: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

/** A price of a tier, provider-agnostic (amount in minor units). */
export interface TierPrice {
  id: string;
  tierId: string;
  period: BillingPeriod;
  /** ISO 4217, upper case */
  currency: string;
  /** Minor units (cents) */
  amount: number;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
  /** Per provider and mode: synced (the provider's price id) or not, and the last sync error */
  links: TierPriceLink[];
}

export interface TierPriceLink {
  provider: PaymentProviderId;
  mode: PaymentMode;
  providerRef: string | null;
  syncedAmount: number | null;
  syncedAt: string | null;
  error: string | null;
}

export const BILLING_PRICE_BOUNDS = { amount: { min: 50, max: 10_000_000 } } as const;

/** Currencies with no minor unit (an amount is whole units). */
export const ZERO_DECIMAL_CURRENCIES = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'UGX', 'XAF', 'XOF'] as const;
/** Currencies with three decimals (an amount is thousandths). */
export const THREE_DECIMAL_CURRENCIES = ['BHD', 'KWD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD'] as const;

export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  if ((ZERO_DECIMAL_CURRENCIES as readonly string[]).includes(c)) return 0;
  if ((THREE_DECIMAL_CURRENCIES as readonly string[]).includes(c)) return 3;
  return 2;
}

export const isCurrencyCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export const BILLING_SUBSCRIPTION_STATUSES = ['pending', 'active', 'past_due', 'canceled', 'ended'] as const;
export type BillingSubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[number];

/** A user's subscription (or admin comp). */
export interface BillingSubscription {
  id: string;
  userId: string;
  tierId: string;
  tierName: string;
  provider: BillingProviderId;
  mode: PaymentMode;
  providerRef: string | null;
  status: BillingSubscriptionStatus;
  period: BillingPeriod | null;
  currency: string | null;
  amount: number | null;
  /** The paid period ends (renewal date while active) */
  currentPeriodEnd: string | null;
  /** Cancels at currentPeriodEnd (the tier stays until then) */
  cancelAtPeriodEnd: boolean;
  /** The tier is held until this time after a cancel (null: while active) */
  accessUntil: string | null;
  /** Admin comp: who granted it and why */
  compBy: string | null;
  compReason: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export const BILLING_PAYMENT_STATUSES = ['succeeded', 'failed', 'refunded', 'partially_refunded'] as const;
export type BillingPaymentStatus = (typeof BILLING_PAYMENT_STATUSES)[number];

/** A charge in the user's billing history. */
export interface BillingPayment {
  id: string;
  userId: string;
  subscriptionId: string | null;
  provider: BillingProviderId;
  mode: PaymentMode;
  providerRef: string;
  status: BillingPaymentStatus;
  currency: string;
  amount: number;
  refundedAmount: number;
  /** Provider receipt / invoice URL when it gives one */
  receiptUrl: string | null;
  occurredAt: string;
}

/** GET /api/me/billing */
export interface MyBilling {
  subscriptions: BillingSubscription[];
  payments: BillingPayment[];
  /** A provider portal is available for this user's active subscription */
  portal: boolean;
}

/** An offer on /upgrade: a tier's prices that at least one enabled provider can sell. */
export interface BillingOffer {
  tierId: string;
  prices: { period: BillingPeriod; currency: string; amount: number; providers: PaymentProviderId[] }[];
}

/** GET /api/billing/plans: what /upgrade needs to switch a tier to the pay flow (public). */
export interface BillingPlans {
  /** Enabled providers (any: /upgrade is in pay mode; none: request or closed, by the admin's "Allow tier requests") */
  providers: { id: PaymentProviderId; name: string; mode: PaymentMode }[];
  /** Tiers that sell now (a price an enabled provider can sell) */
  offers: BillingOffer[];
  pricesIncludeTax: boolean;
  taxRatePercent: number | null;
  /** Paddle.js client token and environment when Paddle is enabled (public values) */
  paddle: { clientToken: string; environment: 'sandbox' | 'production' } | null;
}

/** POST /api/me/billing/checkout body. */
export interface BillingCheckoutInput {
  tierId: string;
  period: BillingPeriod;
  currency: string;
  provider: PaymentProviderId;
  /** The page to come back to (a path on the videos site) */
  returnPath?: string;
}

/** POST /api/me/billing/checkout answer: open `url` (or Paddle's overlay for `paddleTransactionId`). */
export interface BillingCheckout {
  checkoutId: string;
  url: string | null;
  paddleTransactionId: string | null;
}

/** Error codes of the billing API (the web and admin map them to en/ar copy). */
export const BILLING_ERRORS = {
  /** 409: payments are off, or the provider is not enabled */
  providerDisabled: 'billing_provider_disabled',
  /** 404: the tier is request-only or has no price for that period/currency */
  notForSale: 'billing_not_for_sale',
  /** 409: the user already has an active subscription to that tier */
  alreadySubscribed: 'billing_already_subscribed',
  /** 409: the provider cannot be enabled yet (missing settings or credentials) */
  providerIncomplete: 'billing_provider_incomplete',
  /** 503: credential storage (Secrets Store write token) is not connected */
  storageUnavailable: 'billing_credentials_storage_unavailable',
  /** 400 */
  invalid: 'invalid_billing_request',
  /** 404 */
  notFound: 'billing_not_found',
  /** 502: the provider refused or failed */
  providerError: 'billing_provider_error',
  /** 409: the action does not apply in the item's state */
  wrongState: 'billing_wrong_state',
} as const;

/** Admin: one row of the subscriptions list. */
export interface AdminBillingSubscriptionRow extends BillingSubscription {
  displayName: string | null;
  userName: string | null;
  avatarUrl: string | null;
}

export const ADMIN_BILLING_FILTERS = ['active', 'past_due', 'canceled', 'ended', 'comp', 'all'] as const;
export type AdminBillingFilter = (typeof ADMIN_BILLING_FILTERS)[number];

export interface AdminBillingSubscriptionsPage {
  items: AdminBillingSubscriptionRow[];
  next: string | null;
}

/** Admin: one subscription with its payments and webhook events. */
export interface AdminBillingSubscriptionDetail {
  subscription: AdminBillingSubscriptionRow;
  payments: BillingPayment[];
  events: BillingEventRow[];
}

export const BILLING_EVENT_STATUSES = ['queued', 'processed', 'ignored', 'failed'] as const;
export type BillingEventStatus = (typeof BILLING_EVENT_STATUSES)[number];

/** A webhook event as stored (payload is never shown; it can hold personal data). */
export interface BillingEventRow {
  id: string;
  provider: PaymentProviderId;
  mode: PaymentMode;
  eventId: string;
  type: string;
  status: BillingEventStatus;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
  jobId: string | null;
}

/** Admin: what the Payments page loads. */
export interface AdminBillingOverview {
  providers: PaymentProviderConfig[];
  tax: BillingTaxSettings;
  prices: TierPrice[];
  /** Secrets Store writes are possible (the admin-api Cloudflare token is bound) */
  credentialStorage: boolean;
  /** Counts for the page header */
  counts: { active: number; pastDue: number; failedEvents: number };
}

/** Admin comp: grant a tier without payment, until a date or indefinitely. */
export interface BillingCompInput {
  userId: string;
  tierId: string;
  /** ISO date-time; null = until an admin ends it */
  until: string | null;
  reason: string;
}

export const BILLING_COMP_REASON_MAX = 500;
export const BILLING_REFUND_REASON_MAX = 500;

/** The admin-api Secrets Store secret name of a credential (env suffix added by the caller: '', '-qa', '-stage'). */
/**
 * The Secrets Store secret holding a credential. One store serves every
 * environment, so QA and stage carry a suffix: pay-paddle-api-key-live (production),
 * pay-paddle-api-key-live-qa, pay-paddle-api-key-live-stage.
 */
export function paymentSecretName(provider: PaymentProviderId, field: PaymentCredentialField, mode: PaymentMode, environment?: string | null): string {
  const f = field === 'apiKey' ? 'api-key' : 'webhook-secret';
  const suffix = environment === 'qa' || environment === 'stage' ? `-${environment}` : environment && environment !== 'production' ? '-dev' : '';
  return `pay-${provider}-${f}-${mode}${suffix}`;
}

/** The api-videos binding that reads a credential (PAY_PADDLE_API_KEY_TEST, ...). */
export function paymentSecretBinding(provider: PaymentProviderId, field: PaymentCredentialField, mode: PaymentMode): string {
  const f = field === 'apiKey' ? 'API_KEY' : 'WEBHOOK_SECRET';
  return `PAY_${provider.toUpperCase()}_${f}_${mode.toUpperCase()}`;
}

/** The webhook path of a provider on api-videos (outside /api so no browser middleware runs on it). */
export const billingWebhookPath = (provider: PaymentProviderId) => `/webhooks/billing/${provider}`;

/** Job kinds of the billing queue work (admin-jobs queue, api-videos lib/admin/jobs.ts). */
export const BILLING_JOB_KINDS = ['billing.webhook', 'billing.sync-prices', 'billing.cancel', 'billing.refund', 'billing.reconcile'] as const;
export type BillingJobKind = (typeof BILLING_JOB_KINDS)[number];

/** Format an amount in minor units for display (Intl, the viewer's locale). */
export function formatBillingAmount(amount: number, currency: string, locale: string): string {
  const exp = currencyExponent(currency);
  const value = amount / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: exp, maximumFractionDigits: exp }).format(value);
  } catch {
    return `${value.toFixed(exp)} ${currency}`;
  }
}

/** Parse a decimal amount typed by an admin ("9.99") into minor units; null when invalid. */
export function parseBillingAmount(text: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const t = text.trim().replace(/[\s,]/g, '');
  const re = exp === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exp}})?$`);
  if (!re.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const minor = Number(whole) * 10 ** exp + Number((frac + '000').slice(0, exp) || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}
