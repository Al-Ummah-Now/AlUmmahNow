/**
 * Billing configuration in search D1 (migration 0040): providers (non-secret
 * settings, credential status), site-wide tax settings, tier prices and their
 * provider links, and each tier's sale mode. Credentials themselves are read
 * from Secrets Store bindings here and nowhere else.
 */
import {
	BILLING_PERIODS,
	BILLING_PRICE_BOUNDS,
	BILLING_TEXT_LIMITS,
	DEFAULT_BILLING_TAX,
	PAYMENT_CREDENTIAL_FIELDS,
	PAYMENT_MODES,
	PAYMENT_PROVIDER_IDS,
	PAYMENT_PROVIDERS,
	billingWebhookPath,
	isCurrencyCode,
	paymentSecretBinding,
	type BillingPeriod,
	type BillingTaxSettings,
	type CredentialStatus,
	type PaymentCredentialField,
	type PaymentMode,
	type PaymentProviderConfig,
	type PaymentProviderId,
	type TierPrice,
	type TierPriceLink,
} from '@al-ummah/shared-types';
import { getSecret } from '../env-helpers';
import type { ProviderContext } from './provider';

export class BillingError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message = code,
	) {
		super(message);
	}
}

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface BillingEnv {
	SEARCH_DB?: D1Database;
	ENVIRONMENT?: string;
	/** "1": the test provider is available (local stack, QA). Never set in production. */
	PAYMENTS_FAKE_PROVIDER?: string;
	/** This Worker's public origin (webhook URLs, the test checkout page) */
	VIDEOS_API_URL?: string;
	/** The videos site (return URLs after a checkout) */
	VIDEOS_WEB_URL?: string;
	[binding: string]: unknown;
}

export const isProductionEnv = (env: BillingEnv) => env.ENVIRONMENT === 'production';

/** Providers this environment offers: the test provider only outside production and only when switched on. */
export function availableProviders(env: BillingEnv): PaymentProviderId[] {
	return PAYMENT_PROVIDER_IDS.filter((id) => id !== 'fake' || (env.PAYMENTS_FAKE_PROVIDER === '1' && !isProductionEnv(env)));
}

export function assertProvider(env: BillingEnv, id: string): PaymentProviderId {
	if (!(availableProviders(env) as string[]).includes(id)) throw new BillingError(404, 'billing_not_found', `Unknown provider ${id}`);
	return id as PaymentProviderId;
}

function db(env: BillingEnv): D1Database {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB;
}

const parseJson = <T>(text: string | null | undefined, fallback: T): T => {
	if (!text) return fallback;
	try {
		const v = JSON.parse(text);
		return v && typeof v === 'object' ? (v as T) : fallback;
	} catch {
		return fallback;
	}
};

// ---------------------------------------------------------------------------
// Credentials (Secrets Store bindings)
// ---------------------------------------------------------------------------

/** "unset" is the placeholder a credential has before an admin enters it. */
const UNSET = new Set(['', 'unset']);

/**
 * A credential's value from its Secrets Store binding, or null when the
 * binding is missing (not bound in this env yet) or holds no value.
 * The test provider's credentials are its fixed test secret.
 */
export async function readCredential(env: BillingEnv, provider: PaymentProviderId, field: PaymentCredentialField, mode: PaymentMode): Promise<string | null> {
	if (provider === 'fake') {
		const { FAKE_SECRET } = await import('./fake');
		return FAKE_SECRET;
	}
	const binding = env[paymentSecretBinding(provider, field, mode)] as SecretBinding;
	if (!binding) return null;
	try {
		const value = (await getSecret(binding as never, paymentSecretBinding(provider, field, mode))).trim();
		return UNSET.has(value) ? null : value;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

interface ProviderRow {
	id: string;
	enabled: number;
	mode: string;
	settings: string;
	credentials: string;
	updated_at: string | null;
	updated_by: string | null;
}

type Credentials = PaymentProviderConfig['credentials'];

const emptyCredentials = (): Credentials => ({ apiKey: {}, webhookSecret: {} });

export function webhookUrl(env: BillingEnv, provider: PaymentProviderId): string {
	return `${(env.VIDEOS_API_URL ?? '').replace(/\/$/, '')}${billingWebhookPath(provider)}`;
}

/** What a provider still needs before it can be enabled in `mode`. */
export function missingFor(provider: PaymentProviderId, mode: PaymentMode, settings: Record<string, string>, credentials: Credentials, bound: Record<PaymentCredentialField, boolean>): string[] {
	if (provider === 'fake') return [];
	const missing: string[] = [];
	for (const spec of PAYMENT_PROVIDERS[provider].settings) {
		const key = spec.perMode ? `${spec.key}.${mode}` : spec.key;
		if (spec.required && !settings[key]) missing.push(`setting:${spec.key}`);
	}
	for (const field of PAYMENT_CREDENTIAL_FIELDS) {
		if (!credentials[field]?.[mode]) missing.push(`credential:${field}`);
		else if (!bound[field]) missing.push(`binding:${field}`);
	}
	return missing;
}

function toConfig(env: BillingEnv, id: PaymentProviderId, row: ProviderRow | undefined): Omit<PaymentProviderConfig, 'missing'> {
	const mode = (row?.mode === 'live' ? 'live' : 'test') as PaymentMode;
	return {
		id,
		enabled: Number(row?.enabled ?? 0) === 1,
		mode,
		settings: parseJson<Record<string, string>>(row?.settings, {}),
		credentials: { ...emptyCredentials(), ...parseJson<Credentials>(row?.credentials, emptyCredentials()) },
		webhookUrl: webhookUrl(env, id),
		updatedAt: row?.updated_at ?? null,
		updatedBy: row?.updated_by ?? null,
	};
}

const boundMap = (env: BillingEnv, id: PaymentProviderId, mode: PaymentMode): Record<PaymentCredentialField, boolean> => ({
	apiKey: id === 'fake' || !!env[paymentSecretBinding(id, 'apiKey', mode)],
	webhookSecret: id === 'fake' || !!env[paymentSecretBinding(id, 'webhookSecret', mode)],
});

export async function readProviders(env: BillingEnv): Promise<PaymentProviderConfig[]> {
	const rows = (await db(env).prepare('SELECT * FROM billing_providers').all<ProviderRow>()).results ?? [];
	return availableProviders(env).map((id) => {
		const base = toConfig(env, id, rows.find((r) => r.id === id));
		return { ...base, missing: missingFor(id, base.mode, base.settings, base.credentials, boundMap(env, id, base.mode)) };
	});
}

export async function readProvider(env: BillingEnv, id: PaymentProviderId): Promise<PaymentProviderConfig> {
	const found = (await readProviders(env)).find((p) => p.id === id);
	if (!found) throw new BillingError(404, 'billing_not_found');
	return found;
}

/** Enabled providers that are complete for their mode (a provider made incomplete later stops selling). */
export async function enabledProviders(env: BillingEnv): Promise<PaymentProviderConfig[]> {
	return (await readProviders(env)).filter((p) => p.enabled && p.missing.length === 0);
}

async function writeProvider(env: BillingEnv, cfg: Pick<PaymentProviderConfig, 'id' | 'enabled' | 'mode' | 'settings' | 'credentials'>, actorId: string, now: string): Promise<void> {
	await db(env)
		.prepare(
			`INSERT INTO billing_providers (id, enabled, mode, settings, credentials, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, mode = excluded.mode, settings = excluded.settings,
			   credentials = excluded.credentials, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		)
		.bind(cfg.id, cfg.enabled ? 1 : 0, cfg.mode, JSON.stringify(cfg.settings), JSON.stringify(cfg.credentials), now, actorId)
		.run();
}

export interface ProviderUpdate {
	enabled?: boolean;
	mode?: PaymentMode;
	/** Non-secret settings; per-mode keys as "<key>.<mode>"; null/'' clears */
	settings?: Record<string, string | null>;
}

/** Validates and saves non-secret settings, the mode and the enable switch. */
export async function updateProvider(env: BillingEnv, id: PaymentProviderId, input: ProviderUpdate, actorId: string, now = new Date().toISOString()) {
	const previous = await readProvider(env, id);
	const spec = PAYMENT_PROVIDERS[id];
	const settings = { ...previous.settings };
	for (const [rawKey, value] of Object.entries(input.settings ?? {})) {
		const [key, mode] = rawKey.split('.');
		const s = spec.settings.find((x) => x.key === key);
		if (!s || (s.perMode ? !(PAYMENT_MODES as readonly string[]).includes(mode ?? '') : mode !== undefined)) {
			throw new BillingError(400, 'invalid_billing_request', `Unknown setting ${rawKey}`);
		}
		if (value === null || value === '') {
			delete settings[rawKey];
			continue;
		}
		if (typeof value !== 'string' || value.length > (s.maxLength ?? 200)) throw new BillingError(400, 'invalid_billing_request', `${rawKey} is too long`);
		const v = value.trim();
		if (s.kind === 'choice' && !(s.options ?? []).includes(v)) throw new BillingError(400, 'invalid_billing_request', `${rawKey} must be one of ${(s.options ?? []).join(', ')}`);
		if (s.pattern && !new RegExp(s.pattern).test(v)) throw new BillingError(400, 'invalid_billing_request', `${rawKey} is not in the expected format`);
		settings[rawKey] = v;
	}
	const mode = input.mode ?? previous.mode;
	if (!(PAYMENT_MODES as readonly string[]).includes(mode)) throw new BillingError(400, 'invalid_billing_request', 'mode must be test or live');
	if (id === 'fake' && mode === 'live') throw new BillingError(400, 'invalid_billing_request', 'The test provider has no live mode');
	const enabled = input.enabled ?? previous.enabled;
	const missing = missingFor(id, mode, settings, previous.credentials, boundMap(env, id, mode));
	if (enabled && missing.length) throw new BillingError(409, 'billing_provider_incomplete', `Missing: ${missing.join(', ')}`);
	await writeProvider(env, { id, enabled, mode, settings, credentials: previous.credentials }, actorId, now);
	return { previous, provider: await readProvider(env, id) };
}

/** Records that a credential was written to Secrets Store (admin-api did the write). Never receives the value. */
export async function markCredential(env: BillingEnv, id: PaymentProviderId, field: PaymentCredentialField, mode: PaymentMode, actorId: string, cleared = false, now = new Date().toISOString(), last4: string | null = null) {
	if (!(PAYMENT_CREDENTIAL_FIELDS as readonly string[]).includes(field)) throw new BillingError(400, 'invalid_billing_request', 'Unknown credential');
	if (!(PAYMENT_MODES as readonly string[]).includes(mode)) throw new BillingError(400, 'invalid_billing_request', 'mode must be test or live');
	const previous = await readProvider(env, id);
	const credentials: Credentials = { apiKey: { ...previous.credentials.apiKey }, webhookSecret: { ...previous.credentials.webhookSecret } };
	if (cleared) delete credentials[field][mode];
	else credentials[field][mode] = { setAt: now, setBy: actorId, ...(last4 ? { last4 } : {}) } satisfies CredentialStatus;
	// Clearing a credential the enabled mode needs turns the provider off (it could no longer verify or charge)
	const enabled = previous.enabled && !(cleared && mode === previous.mode);
	await writeProvider(env, { id, enabled, mode: previous.mode, settings: previous.settings, credentials }, actorId, now);
	return { previous, provider: await readProvider(env, id) };
}

/** The adapter context for a provider in its current mode; throws when it is not usable. */
export async function providerContext(env: BillingEnv, id: PaymentProviderId, opts: { mode?: PaymentMode; fetchImpl?: typeof fetch } = {}): Promise<ProviderContext> {
	const cfg = await readProvider(env, id);
	const mode = opts.mode ?? cfg.mode;
	const apiKey = await readCredential(env, id, 'apiKey', mode);
	if (!apiKey) throw new BillingError(409, 'billing_provider_incomplete', `${PAYMENT_PROVIDERS[id].name} has no API key for ${mode} mode`);
	const settings: Record<string, string> = {};
	for (const spec of PAYMENT_PROVIDERS[id].settings) {
		const v = cfg.settings[spec.perMode ? `${spec.key}.${mode}` : spec.key];
		if (v) settings[spec.key] = v;
	}
	if (id === 'fake') settings.publicBase = (env.VIDEOS_API_URL ?? '').replace(/\/$/, '');
	const tax = await readTax(env);
	return { mode, apiKey, settings, tax: { pricesIncludeTax: tax.pricesIncludeTax }, fetch: opts.fetchImpl ?? fetch };
}

// ---------------------------------------------------------------------------
// Tax settings
// ---------------------------------------------------------------------------

export async function readTax(env: BillingEnv): Promise<BillingTaxSettings> {
	const row = await db(env).prepare(`SELECT tax, updated_at, updated_by FROM billing_settings WHERE id = 'default'`).first<{ tax: string; updated_at: string | null; updated_by: string | null }>();
	const stored = parseJson<Partial<BillingTaxSettings>>(row?.tax, {});
	return { ...DEFAULT_BILLING_TAX, ...stored, updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null };
}

function text(value: unknown, field: string, max: number): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') throw new BillingError(400, 'invalid_billing_request', `${field} must be text`);
	const t = value.trim();
	if (t.length > max) throw new BillingError(400, 'invalid_billing_request', `${field} must be at most ${max} characters`);
	return t || null;
}

export async function saveTax(env: BillingEnv, input: Partial<BillingTaxSettings>, actorId: string, now = new Date().toISOString()) {
	const previous = await readTax(env);
	const country = text(input.sellerCountry ?? previous.sellerCountry, 'sellerCountry', 2);
	if (country && !/^[A-Z]{2}$/.test(country)) throw new BillingError(400, 'invalid_billing_request', 'sellerCountry must be a two-letter country code');
	const rate = input.taxRatePercent === undefined ? previous.taxRatePercent : input.taxRatePercent;
	if (rate !== null && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100)) throw new BillingError(400, 'invalid_billing_request', 'taxRatePercent must be from 0 to 100');
	const tax = {
		sellerName: input.sellerName === undefined ? previous.sellerName : text(input.sellerName, 'sellerName', BILLING_TEXT_LIMITS.sellerName),
		sellerAddress: input.sellerAddress === undefined ? previous.sellerAddress : text(input.sellerAddress, 'sellerAddress', BILLING_TEXT_LIMITS.sellerAddress),
		sellerCountry: country,
		taxId: input.taxId === undefined ? previous.taxId : text(input.taxId, 'taxId', BILLING_TEXT_LIMITS.taxId),
		pricesIncludeTax: input.pricesIncludeTax === undefined ? previous.pricesIncludeTax : input.pricesIncludeTax === true,
		taxRatePercent: rate === null ? null : Math.round(rate * 100) / 100,
	};
	await db(env)
		.prepare(
			`INSERT INTO billing_settings (id, tax, updated_at, updated_by) VALUES ('default', ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET tax = excluded.tax, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		)
		.bind(JSON.stringify(tax), now, actorId)
		.run();
	return { previous, tax: await readTax(env) };
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

interface PriceRow {
	id: string;
	tier_id: string;
	period: string;
	currency: string;
	amount: number;
	active: number;
	updated_at: string;
	updated_by: string;
}

interface LinkRow {
	price_id: string;
	provider: string;
	mode: string;
	provider_ref: string | null;
	provider_product_ref: string | null;
	checkout_url: string | null;
	synced_amount: number | null;
	synced_at: string | null;
	error: string | null;
}

export async function readLinks(env: BillingEnv): Promise<LinkRow[]> {
	return (await db(env).prepare('SELECT * FROM billing_price_links').all<LinkRow>()).results ?? [];
}

export async function readPrices(env: BillingEnv): Promise<TierPrice[]> {
	const [prices, links] = await Promise.all([db(env).prepare('SELECT * FROM billing_prices ORDER BY tier_id, period, currency').all<PriceRow>(), readLinks(env)]);
	return (prices.results ?? []).map((p) => ({
		id: p.id,
		tierId: p.tier_id,
		period: p.period as BillingPeriod,
		currency: p.currency,
		amount: Number(p.amount),
		active: Number(p.active) === 1,
		updatedAt: p.updated_at,
		updatedBy: p.updated_by,
		links: links
			.filter((l) => l.price_id === p.id)
			.map(
				(l): TierPriceLink => ({
					provider: l.provider as PaymentProviderId,
					mode: l.mode as PaymentMode,
					providerRef: l.provider_ref,
					syncedAmount: l.synced_amount === null ? null : Number(l.synced_amount),
					syncedAt: l.synced_at,
					error: l.error,
				}),
			),
	}));
}

export async function readPrice(env: BillingEnv, id: string): Promise<TierPrice | null> {
	return (await readPrices(env)).find((p) => p.id === id) ?? null;
}

export interface PriceInput {
	tierId: string;
	period: BillingPeriod;
	currency: string;
	amount: number;
	active?: boolean;
}

/** Creates or updates the price for (tier, period, currency). Provider prices follow through a sync job. */
export async function savePrice(env: BillingEnv, input: PriceInput, actorId: string, tierExists: (id: string) => Promise<boolean>, now = new Date().toISOString()) {
	if (!(BILLING_PERIODS as readonly string[]).includes(input.period)) throw new BillingError(400, 'invalid_billing_request', 'period must be month or year');
	const currency = typeof input.currency === 'string' ? input.currency.toUpperCase() : '';
	if (!isCurrencyCode(currency)) throw new BillingError(400, 'invalid_billing_request', 'currency must be a three-letter ISO 4217 code');
	const { min, max } = BILLING_PRICE_BOUNDS.amount;
	if (!Number.isSafeInteger(input.amount) || input.amount < min || input.amount > max) throw new BillingError(400, 'invalid_billing_request', `amount must be ${min} to ${max} minor units`);
	if (!(await tierExists(input.tierId))) throw new BillingError(404, 'tier_not_found', 'No such tier');
	const existing = (await readPrices(env)).find((p) => p.tierId === input.tierId && p.period === input.period && p.currency === currency) ?? null;
	const id = existing?.id ?? `prc_${crypto.randomUUID().replace(/-/g, '')}`;
	const active = input.active ?? existing?.active ?? true;
	await db(env)
		.prepare(
			`INSERT INTO billing_prices (id, tier_id, period, currency, amount, active, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET amount = excluded.amount, active = excluded.active, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		)
		.bind(id, input.tierId, input.period, currency, input.amount, active ? 1 : 0, now, actorId)
		.run();
	return { previous: existing, price: (await readPrice(env, id))! };
}

/** Removes a price (no new checkouts; current subscribers keep their provider price). */
export async function deletePrice(env: BillingEnv, id: string) {
	const previous = await readPrice(env, id);
	if (!previous) throw new BillingError(404, 'billing_not_found');
	await db(env).batch([db(env).prepare('DELETE FROM billing_prices WHERE id = ?').bind(id), db(env).prepare('DELETE FROM billing_price_links WHERE price_id = ?').bind(id)]);
	return { previous };
}

export async function writeLink(
	env: BillingEnv,
	link: { priceId: string; provider: PaymentProviderId; mode: PaymentMode; providerRef: string | null; productRef: string | null; checkoutUrl: string | null; syncedAmount: number | null; error: string | null },
	now = new Date().toISOString(),
) {
	await db(env)
		.prepare(
			`INSERT INTO billing_price_links (price_id, provider, mode, provider_ref, provider_product_ref, checkout_url, synced_amount, synced_at, error)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (price_id, provider, mode) DO UPDATE SET provider_ref = COALESCE(excluded.provider_ref, billing_price_links.provider_ref),
			   provider_product_ref = COALESCE(excluded.provider_product_ref, billing_price_links.provider_product_ref),
			   checkout_url = COALESCE(excluded.checkout_url, billing_price_links.checkout_url),
			   synced_amount = COALESCE(excluded.synced_amount, billing_price_links.synced_amount),
			   synced_at = CASE WHEN excluded.error IS NULL THEN excluded.synced_at ELSE billing_price_links.synced_at END,
			   error = excluded.error`,
		)
		.bind(link.priceId, link.provider, link.mode, link.providerRef, link.productRef, link.checkoutUrl, link.syncedAmount, link.error ? null : now, link.error)
		.run();
}

/** The link of a price that a provider can sell now (synced for the current amount, no error). */
export function sellableLink(price: TierPrice, provider: PaymentProviderId, mode: PaymentMode): TierPriceLink | null {
	const link = price.links.find((l) => l.provider === provider && l.mode === mode);
	return link && link.providerRef && !link.error && link.syncedAmount === price.amount ? link : null;
}

export async function linkByRef(env: BillingEnv, provider: PaymentProviderId, mode: PaymentMode, providerRef: string): Promise<LinkRow | null> {
	return db(env).prepare('SELECT * FROM billing_price_links WHERE provider = ? AND mode = ? AND provider_ref = ?').bind(provider, mode, providerRef).first<LinkRow>();
}

export async function linkFor(env: BillingEnv, priceId: string, provider: PaymentProviderId, mode: PaymentMode): Promise<LinkRow | null> {
	return db(env).prepare('SELECT * FROM billing_price_links WHERE price_id = ? AND provider = ? AND mode = ?').bind(priceId, provider, mode).first<LinkRow>();
}

/** Can this provider charge this currency? (null list = any) */
export const providerTakesCurrency = (provider: PaymentProviderId, currency: string) => {
	const list = PAYMENT_PROVIDERS[provider].currencies;
	return !list || list.includes(currency);
};
