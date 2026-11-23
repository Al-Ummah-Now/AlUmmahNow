/**
 * SEARCH_DB access for social (migration 0046_social.sql). Rows in, views out; no network calls here.
 */
import {
	SOCIAL_EVENTS,
	defaultFormat,
	defaultTemplate,
	formatsFor,
	isSocialEvent,
	normalizeSocialSettings,
	spendMonth,
	type D1Database,
	type SocialAccountStatus,
	type SocialAccountView,
	type SocialDeliveryStatus,
	type SocialDeliveryView,
	type SocialEvent,
	type SocialFormat,
	type SocialLanguage,
	type SocialNetwork,
	type SocialPlatformSettings,
	type SocialRuleView,
	type SocialTemplate,
	type SocialWebhookEvent,
	type SocialWebhookView,
} from '@al-ummah/shared-types';
import { overlaySwitch } from '../features/switches';

export interface SocialDbEnv {
	SEARCH_DB?: unknown;
}

export class SocialError extends Error {
	constructor(
		readonly status: 400 | 403 | 404 | 409 | 422 | 429 | 502 | 503,
		readonly code: string,
		message?: string,
	) {
		super(message ?? code);
	}
}

export function socialDb(env: SocialDbEnv): D1Database {
	if (!env.SEARCH_DB) throw new SocialError(503, 'unavailable');
	return env.SEARCH_DB as D1Database;
}

export interface AccountRow {
	id: string;
	channel_id: string;
	network: SocialNetwork;
	remote_id: string;
	handle: string;
	display_name: string;
	instance: string | null;
	language: SocialLanguage;
	status: SocialAccountStatus;
	status_reason: string | null;
	token_ciphertext: string | null;
	token_expires_at: number | null;
	refresh_lease_until: number | null;
	connected_by: string | null;
	created_at: number;
	updated_at: number;
}

export interface RuleRow {
	account_id: string;
	event: SocialEvent;
	enabled: number;
	format: SocialFormat;
	include_link: number;
}

export interface DeliveryRow {
	id: string;
	channel_id: string;
	account_id: string;
	network: SocialNetwork;
	event: SocialEvent;
	entity_id: string;
	entity_title: string | null;
	format: SocialFormat;
	include_link: number;
	status: SocialDeliveryStatus;
	attempts: number;
	last_error: string | null;
	remote_id: string | null;
	remote_url: string | null;
	cost_micros: number;
	created_at: number;
	updated_at: number;
	sent_at: number | null;
}

export interface WebhookRow {
	id: string;
	channel_id: string;
	url: string;
	secret_ciphertext: string;
	events: string;
	enabled: number;
	failure_count: number;
	last_status: string | null;
	last_delivery_at: number | null;
	created_by: string | null;
	created_at: number;
	updated_at: number;
}

export interface WebhookDeliveryRow {
	id: string;
	webhook_id: string;
	channel_id: string;
	event: SocialWebhookEvent;
	entity_id: string;
	status: 'queued' | 'sending' | 'sent' | 'failed';
	attempts: number;
	response_status: number | null;
	last_error: string | null;
	created_at: number;
	updated_at: number;
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : undefined);

export function profileUrl(a: Pick<AccountRow, 'network' | 'handle' | 'instance'>): string | undefined {
	const handle = a.handle.replace(/^@/, '');
	if (!handle) return undefined;
	switch (a.network) {
		case 'x':
			return `https://x.com/${encodeURIComponent(handle)}`;
		case 'telegram':
			return `https://t.me/${encodeURIComponent(handle)}`;
		case 'bluesky':
			return `https://bsky.app/profile/${encodeURIComponent(handle)}`;
		case 'mastodon': {
			const [user, host] = handle.split('@');
			return host ? `https://${host}/@${encodeURIComponent(user!)}` : undefined;
		}
	}
}

export function ruleViews(rows: RuleRow[]): SocialRuleView[] {
	return SOCIAL_EVENTS.map((event) => {
		const r = rows.find((x) => x.event === event);
		const format = r && formatsFor(event).includes(r.format) ? r.format : defaultFormat(event);
		return { event, enabled: !!r?.enabled, format, includeLink: !!r?.include_link };
	});
}

export function accountView(a: AccountRow, rules: RuleRow[]): SocialAccountView {
	return {
		id: a.id,
		channelId: a.channel_id,
		network: a.network,
		handle: a.handle,
		displayName: a.display_name,
		...(a.instance ? { instance: a.instance } : {}),
		...(profileUrl(a) ? { profileUrl: profileUrl(a) } : {}),
		language: a.language === 'ar' ? 'ar' : 'en',
		status: a.status,
		...(a.status_reason ? { statusReason: a.status_reason } : {}),
		connectedAt: iso(a.created_at)!,
		rules: ruleViews(rules.filter((r) => r.account_id === a.id)),
	};
}

export async function listAccounts(env: SocialDbEnv, channelId: string): Promise<AccountRow[]> {
	const { results } = await socialDb(env).prepare('SELECT * FROM social_accounts WHERE channel_id = ? ORDER BY created_at').bind(channelId).all<AccountRow>();
	return results ?? [];
}

export async function listRules(env: SocialDbEnv, accountIds: string[]): Promise<RuleRow[]> {
	if (!accountIds.length) return [];
	const marks = accountIds.map(() => '?').join(',');
	const { results } = await socialDb(env).prepare(`SELECT account_id, event, enabled, format, include_link FROM social_rules WHERE account_id IN (${marks})`).bind(...accountIds).all<RuleRow>();
	return results ?? [];
}

export async function channelAccountViews(env: SocialDbEnv, channelId: string): Promise<SocialAccountView[]> {
	const accounts = await listAccounts(env, channelId);
	const [rules, limits] = await Promise.all([
		listRules(env, accounts.map((a) => a.id)),
		// Cached only: the overview never calls an instance (the sender and connect keep the cache fresh)
		readMastodonLimits(env, accounts.filter((a) => a.network === 'mastodon' && a.instance).map((a) => a.instance!)),
	]);
	return accounts.map((a) => {
		const view = accountView(a, rules);
		const limit = a.network === 'mastodon' && a.instance ? limits.get(a.instance) : undefined;
		return limit ? { ...view, maxChars: limit.maxChars } : view;
	});
}

export async function readAccount(env: SocialDbEnv, id: string): Promise<AccountRow | null> {
	return socialDb(env).prepare('SELECT * FROM social_accounts WHERE id = ?').bind(id).first<AccountRow>();
}

export interface NewAccount {
	channelId: string;
	network: SocialNetwork;
	remoteId: string;
	handle: string;
	displayName: string;
	instance?: string | null;
	language: SocialLanguage;
	tokenCiphertext: string | null;
	tokenExpiresAt: number | null;
	connectedBy: string;
}

/**
 * Stores a connection. Connecting the same network account to the same channel again is a reconnect: the row
 * keeps its id and rules, gets the new tokens and is active again.
 */
export async function upsertAccount(env: SocialDbEnv, a: NewAccount, now = Date.now()): Promise<AccountRow> {
	const db = socialDb(env);
	const existing = await db
		.prepare('SELECT * FROM social_accounts WHERE channel_id = ? AND network = ? AND remote_id = ?')
		.bind(a.channelId, a.network, a.remoteId)
		.first<AccountRow>();
	if (existing) {
		await db
			.prepare(
				`UPDATE social_accounts SET handle = ?, display_name = ?, instance = ?, status = 'active', status_reason = NULL,
				 token_ciphertext = ?, token_expires_at = ?, refresh_lease_until = NULL, connected_by = ?, updated_at = ? WHERE id = ?`,
			)
			.bind(a.handle, a.displayName, a.instance ?? null, a.tokenCiphertext, a.tokenExpiresAt, a.connectedBy, now, existing.id)
			.run();
		return (await readAccount(env, existing.id))!;
	}
	const id = `sa_${crypto.randomUUID().replace(/-/g, '')}`;
	await db
		.prepare(
			`INSERT INTO social_accounts (id, channel_id, network, remote_id, handle, display_name, instance, language, status, token_ciphertext, token_expires_at, connected_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
		)
		.bind(id, a.channelId, a.network, a.remoteId, a.handle, a.displayName, a.instance ?? null, a.language, a.tokenCiphertext, a.tokenExpiresAt, a.connectedBy, now, now)
		.run();
	return (await readAccount(env, id))!;
}

export async function updateAccountTokens(env: SocialDbEnv, id: string, tokenCiphertext: string, expiresAt: number | null, now = Date.now()): Promise<void> {
	await socialDb(env)
		.prepare('UPDATE social_accounts SET token_ciphertext = ?, token_expires_at = ?, refresh_lease_until = NULL, updated_at = ? WHERE id = ?')
		.bind(tokenCiphertext, expiresAt, now, id)
		.run();
}

/** Takes the refresh lease (one refresh at a time; rotating refresh tokens break on two). */
export async function takeRefreshLease(env: SocialDbEnv, id: string, now = Date.now(), ms = 60_000): Promise<boolean> {
	const r = await socialDb(env)
		.prepare('UPDATE social_accounts SET refresh_lease_until = ? WHERE id = ? AND (refresh_lease_until IS NULL OR refresh_lease_until < ?)')
		.bind(now + ms, id, now)
		.run();
	return changes(r) > 0;
}

export async function setAccountStatus(env: SocialDbEnv, id: string, status: SocialAccountStatus, reason: string | null, now = Date.now()): Promise<void> {
	await socialDb(env).prepare('UPDATE social_accounts SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?').bind(status, reason, now, id).run();
}

export async function setAccountLanguage(env: SocialDbEnv, id: string, language: SocialLanguage, now = Date.now()): Promise<void> {
	await socialDb(env).prepare('UPDATE social_accounts SET language = ?, updated_at = ? WHERE id = ?').bind(language, now, id).run();
}

/** Disconnect: tokens and rules go in the same batch; queued posts to it are cancelled. Sent-post records stay. */
export async function deleteAccount(env: SocialDbEnv, id: string, now = Date.now()): Promise<void> {
	const db = socialDb(env);
	await db.batch([
		db.prepare('DELETE FROM social_rules WHERE account_id = ?').bind(id),
		db.prepare(`UPDATE social_deliveries SET status = 'cancelled', last_error = 'account_disconnected', updated_at = ? WHERE account_id = ? AND status IN ('queued', 'sending', 'blocked', 'failed')`).bind(now, id),
		db.prepare('DELETE FROM social_accounts WHERE id = ?').bind(id),
	]);
}

export async function saveRule(env: SocialDbEnv, accountId: string, rule: { event: SocialEvent; enabled: boolean; format: SocialFormat; includeLink: boolean }, now = Date.now()): Promise<void> {
	if (!formatsFor(rule.event).includes(rule.format)) throw new SocialError(400, 'invalid_format');
	await socialDb(env)
		.prepare(
			`INSERT INTO social_rules (account_id, event, enabled, format, include_link, updated_at) VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (account_id, event) DO UPDATE SET enabled = excluded.enabled, format = excluded.format, include_link = excluded.include_link, updated_at = excluded.updated_at`,
		)
		.bind(accountId, rule.event, rule.enabled ? 1 : 0, rule.format, rule.includeLink ? 1 : 0, now)
		.run();
}

// --- templates -----------------------------------------------------------------------------------

export async function listTemplates(env: SocialDbEnv, channelId: string): Promise<SocialTemplate[]> {
	const { results } = await socialDb(env).prepare('SELECT event, lang, body FROM social_templates WHERE channel_id = ?').bind(channelId).all<SocialTemplate>();
	const out: SocialTemplate[] = [];
	for (const event of SOCIAL_EVENTS) {
		for (const lang of ['en', 'ar'] as const) {
			const row = (results ?? []).find((r) => r.event === event && r.lang === lang);
			out.push({ event, lang, body: row?.body ?? defaultTemplate(event) });
		}
	}
	return out;
}

export async function saveTemplate(env: SocialDbEnv, channelId: string, t: SocialTemplate, userId: string, now = Date.now()): Promise<void> {
	await socialDb(env)
		.prepare(
			`INSERT INTO social_templates (channel_id, event, lang, body, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (channel_id, event, lang) DO UPDATE SET body = excluded.body, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
		)
		.bind(channelId, t.event, t.lang, t.body, userId, now)
		.run();
}

// --- deliveries ----------------------------------------------------------------------------------

export function deliveryView(d: DeliveryRow, account?: Pick<AccountRow, 'handle'>): SocialDeliveryView {
	return {
		id: d.id,
		accountId: d.account_id,
		network: d.network,
		handle: account?.handle ?? '',
		event: d.event,
		entityId: d.entity_id,
		...(d.entity_title ? { entityTitle: d.entity_title } : {}),
		format: d.format,
		status: d.status,
		attempts: d.attempts,
		...(d.last_error ? { error: d.last_error } : {}),
		...(d.remote_url ? { remoteUrl: d.remote_url } : {}),
		createdAt: iso(d.created_at)!,
		updatedAt: iso(d.updated_at)!,
	};
}

export async function listDeliveries(env: SocialDbEnv, channelId: string, limit = 50): Promise<SocialDeliveryView[]> {
	const db = socialDb(env);
	const { results } = await db.prepare('SELECT * FROM social_deliveries WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?').bind(channelId, Math.min(100, limit)).all<DeliveryRow>();
	const accounts = await listAccounts(env, channelId);
	return (results ?? []).map((d) => deliveryView(d, accounts.find((a) => a.id === d.account_id)));
}

export async function readDelivery(env: SocialDbEnv, id: string): Promise<DeliveryRow | null> {
	return socialDb(env).prepare('SELECT * FROM social_deliveries WHERE id = ?').bind(id).first<DeliveryRow>();
}

/** Claims a delivery for one attempt (queued/failed/blocked → sending). Null when it was sent or cancelled meanwhile. */
export async function claimDelivery(env: SocialDbEnv, id: string, now = Date.now()): Promise<DeliveryRow | null> {
	const db = socialDb(env);
	// A crashed attempt leaves 'sending'; after 15 minutes it may be claimed again
	const r = await db
		.prepare(
			`UPDATE social_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
			 WHERE id = ? AND (status IN ('queued', 'failed', 'blocked') OR (status = 'sending' AND updated_at < ?))`,
		)
		.bind(now, id, now - 15 * 60_000)
		.run();
	if (!changes(r)) return null;
	return readDelivery(env, id);
}

export async function finishDelivery(
	env: SocialDbEnv,
	id: string,
	result: { status: SocialDeliveryStatus; error?: string | null; remoteId?: string | null; remoteUrl?: string | null; costMicros?: number },
	now = Date.now(),
): Promise<void> {
	await socialDb(env)
		.prepare(
			`UPDATE social_deliveries SET status = ?, last_error = ?, remote_id = COALESCE(?, remote_id), remote_url = COALESCE(?, remote_url),
			 cost_micros = cost_micros + ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ? WHERE id = ?`,
		)
		.bind(result.status, result.error ?? null, result.remoteId ?? null, result.remoteUrl ?? null, result.costMicros ?? 0, result.status, now, now, id)
		.run();
}

/** Puts a failed or blocked delivery back in the queue (Studio's Retry, the admin's Retry). */
export async function requeueDelivery(env: SocialDbEnv, id: string, patch: { format?: SocialFormat } = {}, now = Date.now()): Promise<boolean> {
	const r = await socialDb(env)
		.prepare(`UPDATE social_deliveries SET status = 'queued', attempts = 0, last_error = NULL, format = COALESCE(?, format), updated_at = ? WHERE id = ? AND status IN ('failed', 'blocked')`)
		.bind(patch.format ?? null, now, id)
		.run();
	return changes(r) > 0;
}

/** Inserts the planned deliveries; one already planned for the same account and entity is kept as it is. */
export async function insertDeliveries(
	env: SocialDbEnv,
	rows: Array<Pick<DeliveryRow, 'channel_id' | 'account_id' | 'network' | 'event' | 'entity_id' | 'entity_title' | 'format' | 'include_link'>>,
	now = Date.now(),
): Promise<string[]> {
	if (!rows.length) return [];
	const db = socialDb(env);
	const ids = rows.map(() => `sd_${crypto.randomUUID().replace(/-/g, '')}`);
	const results = await db.batch(
		rows.map((r, i) =>
			db
				.prepare(
					`INSERT INTO social_deliveries (id, channel_id, account_id, network, event, entity_id, entity_title, format, include_link, status, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?) ON CONFLICT (account_id, event, entity_id) DO NOTHING`,
				)
				.bind(ids[i], r.channel_id, r.account_id, r.network, r.event, r.entity_id, r.entity_title, r.format, r.include_link, now, now),
		),
	);
	return ids.filter((_, i) => ((results[i] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0);
}

// --- webhooks ------------------------------------------------------------------------------------

export function webhookView(w: WebhookRow): SocialWebhookView {
	return {
		id: w.id,
		url: w.url,
		events: w.events.split(',').filter(Boolean) as SocialWebhookEvent[],
		enabled: !!w.enabled,
		createdAt: iso(w.created_at)!,
		...(w.last_status ? { lastStatus: w.last_status } : {}),
		...(w.last_delivery_at ? { lastDeliveryAt: iso(w.last_delivery_at) } : {}),
		failureCount: w.failure_count,
	};
}

export async function listWebhooks(env: SocialDbEnv, channelId: string): Promise<WebhookRow[]> {
	const { results } = await socialDb(env).prepare('SELECT * FROM social_webhooks WHERE channel_id = ? ORDER BY created_at').bind(channelId).all<WebhookRow>();
	return results ?? [];
}

export async function readWebhook(env: SocialDbEnv, id: string): Promise<WebhookRow | null> {
	return socialDb(env).prepare('SELECT * FROM social_webhooks WHERE id = ?').bind(id).first<WebhookRow>();
}

export async function readWebhookDelivery(env: SocialDbEnv, id: string): Promise<WebhookDeliveryRow | null> {
	return socialDb(env).prepare('SELECT * FROM social_webhook_deliveries WHERE id = ?').bind(id).first<WebhookDeliveryRow>();
}

export async function listWebhookDeliveries(env: SocialDbEnv, webhookId: string, limit = 20): Promise<WebhookDeliveryRow[]> {
	const { results } = await socialDb(env).prepare('SELECT * FROM social_webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?').bind(webhookId, limit).all<WebhookDeliveryRow>();
	return results ?? [];
}

// --- settings and spend --------------------------------------------------------------------------

export async function readSetting(env: SocialDbEnv, key: string): Promise<string | null> {
	const row = await socialDb(env).prepare('SELECT value FROM social_settings WHERE key = ?').bind(key).first<{ value: string }>();
	return row?.value ?? null;
}

export async function writeSetting(env: SocialDbEnv, key: string, value: string, by: string, now = Date.now()): Promise<void> {
	await socialDb(env)
		.prepare(`INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
		.bind(key, value, by, now)
		.run();
}

export async function deleteSetting(env: SocialDbEnv, key: string): Promise<void> {
	await socialDb(env).prepare('DELETE FROM social_settings WHERE key = ?').bind(key).run();
}

/** A Mastodon instance's character limit, cached in social_settings (`mastodon_limit:<instance>`). */
const MASTODON_LIMIT_PREFIX = 'mastodon_limit:';
/** Re-read from the instance after this long (admins change it rarely) */
export const MASTODON_LIMIT_TTL_MS = 7 * 24 * 3600_000;

export interface CachedInstanceLimit {
	maxChars: number;
	at: number;
}

export async function readMastodonLimits(env: SocialDbEnv, instances: readonly string[]): Promise<Map<string, CachedInstanceLimit>> {
	const out = new Map<string, CachedInstanceLimit>();
	const unique = [...new Set(instances.filter(Boolean))];
	if (!unique.length) return out;
	const { results } = await socialDb(env)
		.prepare(`SELECT key, value FROM social_settings WHERE key IN (${unique.map(() => '?').join(', ')})`)
		.bind(...unique.map((i) => MASTODON_LIMIT_PREFIX + i))
		.all<{ key: string; value: string }>();
	for (const row of results ?? []) {
		try {
			const v = JSON.parse(row.value) as Partial<CachedInstanceLimit>;
			if (typeof v.maxChars === 'number' && v.maxChars > 0 && typeof v.at === 'number') out.set(row.key.slice(MASTODON_LIMIT_PREFIX.length), { maxChars: v.maxChars, at: v.at });
		} catch {
			// A malformed value is read again from the instance
		}
	}
	return out;
}

export async function writeMastodonLimit(env: SocialDbEnv, instance: string, maxChars: number, now = Date.now()): Promise<void> {
	await writeSetting(env, MASTODON_LIMIT_PREFIX + instance, JSON.stringify({ maxChars, at: now }), 'system', now);
}

export async function readPlatformSettings(env: SocialDbEnv, opts: { raw?: boolean } = {}): Promise<SocialPlatformSettings> {
	const settings = await readStoredPlatformSettings(env);
	if (opts.raw) return settings;
	// The Features page switch decides `enabled` once set (lib/features/switches.ts)
	return { ...settings, enabled: await overlaySwitch(env as never, 'socialAutopost', settings.enabled) };
}

async function readStoredPlatformSettings(env: SocialDbEnv): Promise<SocialPlatformSettings> {
	const raw = await readSetting(env, 'platform');
	let parsed: unknown = null;
	try {
		parsed = raw ? JSON.parse(raw) : null;
	} catch {
		parsed = null;
	}
	return normalizeSocialSettings(parsed);
}

export async function readSpend(env: SocialDbEnv, network: SocialNetwork, month = spendMonth()): Promise<{ costMicros: number; posts: number }> {
	const row = await socialDb(env).prepare('SELECT cost_micros, posts FROM social_spend WHERE month = ? AND network = ?').bind(month, network).first<{ cost_micros: number; posts: number }>();
	return { costMicros: row?.cost_micros ?? 0, posts: row?.posts ?? 0 };
}

/**
 * Reserves a paid post's cost against the cap in one conditional write, so parallel deliveries can't overshoot it.
 * Returns false when the post doesn't fit.
 */
export async function reserveSpend(env: SocialDbEnv, network: SocialNetwork, costMicros: number, capMicros: number, linkPauseMicros: number, month = spendMonth()): Promise<boolean> {
	const db = socialDb(env);
	await db.prepare('INSERT INTO social_spend (month, network, cost_micros, posts) VALUES (?, ?, 0, 0) ON CONFLICT (month, network) DO NOTHING').bind(month, network).run();
	const limit = Math.min(capMicros, linkPauseMicros);
	const r = await db
		.prepare('UPDATE social_spend SET cost_micros = cost_micros + ?, posts = posts + 1 WHERE month = ? AND network = ? AND cost_micros + ? <= ?')
		.bind(costMicros, month, network, costMicros, limit)
		.run();
	return changes(r) > 0;
}

/** Gives a reservation back (the post was not made). */
export async function releaseSpend(env: SocialDbEnv, network: SocialNetwork, costMicros: number, month = spendMonth()): Promise<void> {
	await socialDb(env)
		.prepare('UPDATE social_spend SET cost_micros = MAX(0, cost_micros - ?), posts = MAX(0, posts - 1) WHERE month = ? AND network = ?')
		.bind(costMicros, month, network)
		.run();
}

// --- audit ---------------------------------------------------------------------------------------

export async function audit(env: SocialDbEnv, channelId: string, actorId: string, action: string, target?: string, detail?: Record<string, unknown>, now = Date.now()): Promise<void> {
	await socialDb(env)
		.prepare('INSERT INTO social_audit (id, channel_id, actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
		.bind(crypto.randomUUID(), channelId, actorId, action, target ?? null, detail ? JSON.stringify(detail).slice(0, 2000) : null, now)
		.run();
}

export function parseEvent(value: unknown): SocialEvent {
	if (!isSocialEvent(value)) throw new SocialError(400, 'invalid_event');
	return value;
}

/** Rows a D1 write changed. */
export function changes(result: unknown): number {
	return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
}
