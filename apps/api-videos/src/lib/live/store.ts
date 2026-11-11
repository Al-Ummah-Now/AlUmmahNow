/**
 * Live providers: settings, channel overrides, the round-robin counter and
 * sessions in D1 (SEARCH_DB, migrations/search/0019_live_providers.sql).
 *
 * Settings are read on every stream create through a 15 s per-isolate cache,
 * so an admin change reaches new streams within 15 s and never touches a
 * session that is already live.
 */
import {
	DEFAULT_LIVE_ROUTING,
	LIVE_PROVIDERS,
	normaliseLiveRouting,
	type LiveChannelOverride,
	type LiveProviderId,
	type LiveProviderUsage,
	type LiveRoutingSettings,
	type LiveSessionStatus,
} from '@al-ummah/shared-types';

export const SETTINGS_TTL_MS = 15_000;
const ROUTING_KEY = 'routing';

let cached: { db: D1Database; at: number; value: LiveRoutingSettings } | null = null;

/** Drops this isolate's cached settings (tests, and after a write). */
export function forgetLiveRouting(): void {
	cached = null;
}

export async function readLiveRouting(db: D1Database, now = Date.now()): Promise<LiveRoutingSettings> {
	if (cached && cached.db === db && now - cached.at < SETTINGS_TTL_MS) return cached.value;
	const row = await db.prepare('SELECT value, updated_by, updated_at FROM live_settings WHERE key = ?').bind(ROUTING_KEY).first<{ value: string; updated_by: string | null; updated_at: string | null }>();
	let value = DEFAULT_LIVE_ROUTING;
	if (row) {
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(row.value);
		} catch {
			parsed = null;
		}
		value = { ...normaliseLiveRouting(parsed), updatedAt: row.updated_at, updatedBy: row.updated_by };
	}
	cached = { db, at: now, value };
	return value;
}

/** Applies a partial change on top of the current settings; returns both versions. */
export async function writeLiveRouting(
	db: D1Database,
	change: unknown,
	actor: string,
	now = new Date(),
): Promise<{ previous: LiveRoutingSettings; current: LiveRoutingSettings }> {
	forgetLiveRouting();
	const previous = await readLiveRouting(db, now.getTime());
	const patch = (change && typeof change === 'object' ? change : {}) as Record<string, unknown>;
	// Nested objects merge per provider, so a change to one toggle keeps the rest.
	const merged = {
		...previous,
		...patch,
		providers: mergeEach(previous.providers, patch.providers),
		rates: mergeEach(previous.rates, patch.rates),
		selfhosted: { ...previous.selfhosted, ...((patch.selfhosted as object) ?? {}) },
	};
	const at = now.toISOString();
	const current = { ...normaliseLiveRouting(merged, previous), updatedAt: at, updatedBy: actor };
	const { updatedAt: _a, updatedBy: _b, ...stored } = current;
	await db
		.prepare('INSERT INTO live_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
		.bind(ROUTING_KEY, JSON.stringify(stored), actor, at)
		.run();
	forgetLiveRouting();
	return { previous, current };
}

function mergeEach<T extends Record<LiveProviderId, object>>(base: T, patch: unknown): T {
	const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<LiveProviderId, object>>;
	const out = { ...base };
	for (const id of LIVE_PROVIDERS) if (p[id] && typeof p[id] === 'object') (out as Record<string, object>)[id] = { ...base[id], ...p[id] };
	return out;
}

/** The next round-robin sequence number (atomic in D1). */
export async function nextAssignSeq(db: D1Database): Promise<number> {
	const row = await db.prepare("UPDATE live_counters SET value = value + 1 WHERE name = 'assign' RETURNING value").first<{ value: number }>();
	return Math.max(0, (row?.value ?? 1) - 1);
}

// ---------------------------------------------------------------------------
// Channel overrides
// ---------------------------------------------------------------------------

type OverrideRow = { channel_id: string; provider: LiveProviderId; note: string | null; updated_by: string; updated_at: string; admin_title?: string | null };
const toOverride = (r: OverrideRow): LiveChannelOverride => ({
	channelId: r.channel_id,
	channelName: r.admin_title ?? null,
	provider: r.provider,
	note: r.note,
	updatedBy: r.updated_by,
	updatedAt: r.updated_at,
});

export async function readChannelOverride(db: D1Database, channelId: string | null | undefined): Promise<LiveProviderId | null> {
	if (!channelId) return null;
	const row = await db.prepare('SELECT provider FROM live_channel_overrides WHERE channel_id = ?').bind(channelId).first<{ provider: LiveProviderId }>();
	return row?.provider ?? null;
}

export async function listChannelOverrides(db: D1Database): Promise<LiveChannelOverride[]> {
	const { results } = await db
		.prepare(
			"SELECT o.channel_id, o.provider, o.note, o.updated_by, o.updated_at, c.admin_title FROM live_channel_overrides o LEFT JOIN content_ownership c ON c.kind = 'channel' AND c.id = o.channel_id ORDER BY o.updated_at DESC LIMIT 500",
		)
		.all<OverrideRow>();
	return (results ?? []).map(toOverride);
}

export async function setChannelOverride(db: D1Database, channelId: string, provider: LiveProviderId, note: string | null, actor: string, now = new Date()): Promise<{ previous: LiveProviderId | null }> {
	const previous = await readChannelOverride(db, channelId);
	await db
		.prepare('INSERT INTO live_channel_overrides (channel_id, provider, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET provider = excluded.provider, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
		.bind(channelId, provider, note, actor, now.toISOString())
		.run();
	return { previous };
}

export async function removeChannelOverride(db: D1Database, channelId: string): Promise<{ previous: LiveProviderId | null }> {
	const previous = await readChannelOverride(db, channelId);
	await db.prepare('DELETE FROM live_channel_overrides WHERE channel_id = ?').bind(channelId).run();
	return { previous };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface LiveSessionRow {
	id: string;
	stream_id: string;
	channel_id: string | null;
	provider: LiveProviderId;
	provider_ref: string | null;
	status: LiveSessionStatus;
	reason: string;
	preferred: string | null;
	seq: number | null;
	failover_from: string | null;
	failover_error: string | null;
	key_version: number;
	low_latency: number;
	is_test: number;
	created_at: number;
	start_requested_at: number | null;
	ingest_connected_at: number | null;
	first_segment_at: number | null;
	last_segment_at: number | null;
	ended_at: number | null;
	end_reason: string | null;
	vod_ready_at: number | null;
	vod_url: string | null;
	playback_url: string | null;
	ingest_bytes: number;
	segments: number;
	reconnects: number;
	edge_requests: number;
	delivered_bytes: number;
	cache_hits: number;
	r2_reads: number;
	r2_writes: number;
	stored_bytes: number;
	peak_viewers: number;
	viewer_seconds: number;
	error: string | null;
}

export async function insertSession(db: D1Database, s: Pick<LiveSessionRow, 'id' | 'stream_id' | 'channel_id' | 'provider' | 'provider_ref' | 'reason' | 'preferred' | 'seq' | 'failover_from' | 'failover_error' | 'low_latency' | 'is_test' | 'created_at' | 'playback_url'>): Promise<void> {
	await db
		.prepare(
			'INSERT INTO live_sessions (id, stream_id, channel_id, provider, provider_ref, reason, preferred, seq, failover_from, failover_error, low_latency, is_test, created_at, playback_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
		)
		.bind(s.id, s.stream_id, s.channel_id, s.provider, s.provider_ref, s.reason, s.preferred, s.seq, s.failover_from, s.failover_error, s.low_latency, s.is_test, s.created_at, s.playback_url)
		.run();
}

export async function readSession(db: D1Database, id: string): Promise<LiveSessionRow | null> {
	return db.prepare('SELECT * FROM live_sessions WHERE id = ?').bind(id).first<LiveSessionRow>();
}

/** Columns a caller may set (never the id, stream or provider). */
const SESSION_UPDATABLE = new Set([
	'provider_ref', 'status', 'start_requested_at', 'ingest_connected_at', 'first_segment_at', 'last_segment_at', 'ended_at', 'end_reason',
	'vod_ready_at', 'vod_url', 'playback_url', 'stored_bytes', 'peak_viewers', 'viewer_seconds', 'error', 'key_version',
]);

export async function updateSession(db: D1Database, id: string, set: Partial<LiveSessionRow>, onlyIfStatus?: LiveSessionStatus[]): Promise<boolean> {
	const keys = Object.keys(set).filter((k) => SESSION_UPDATABLE.has(k));
	if (!keys.length) return false;
	const where = onlyIfStatus?.length ? ` AND status IN (${onlyIfStatus.map(() => '?').join(', ')})` : '';
	const result = await db
		.prepare(`UPDATE live_sessions SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?${where}`)
		.bind(...keys.map((k) => (set as Record<string, unknown>)[k] ?? null), id, ...(onlyIfStatus ?? []))
		.run();
	return ((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
}

/** Adds counters (cost units) to a session. */
export async function addSessionCounters(
	db: D1Database,
	id: string,
	add: Partial<Record<'ingest_bytes' | 'segments' | 'reconnects' | 'edge_requests' | 'delivered_bytes' | 'cache_hits' | 'r2_reads' | 'r2_writes', number>>,
): Promise<void> {
	const keys = Object.keys(add).filter((k) => (add as Record<string, number>)[k]);
	if (!keys.length) return;
	await db
		.prepare(`UPDATE live_sessions SET ${keys.map((k) => `${k} = ${k} + ?`).join(', ')} WHERE id = ?`)
		.bind(...keys.map((k) => Math.round((add as Record<string, number>)[k])), id)
		.run();
}

export async function recordEvent(db: D1Database, e: { sessionId: string; provider: LiveProviderId; kind: string; at?: number; value?: number | null; detail?: unknown }): Promise<void> {
	await db
		.prepare('INSERT INTO live_events (id, session_id, provider, kind, at, value, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
		.bind(crypto.randomUUID(), e.sessionId, e.provider, e.kind, e.at ?? Date.now(), e.value ?? null, e.detail === undefined ? null : JSON.stringify(e.detail).slice(0, 2000))
		.run();
}

/** Sessions live now, per provider, and this month's estimated spend. */
export async function readUsage(db: D1Database, settings: LiveRoutingSettings, now = Date.now()): Promise<Record<LiveProviderId, Omit<LiveProviderUsage, 'available'>>> {
	const d = new Date(now);
	const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
	const [{ results: active }, { results: month }] = await Promise.all([
		db.prepare("SELECT provider, COUNT(*) AS n FROM live_sessions WHERE status = 'live' GROUP BY provider").all<{ provider: LiveProviderId; n: number }>(),
		db
			.prepare(
				`SELECT provider,
				        SUM(CASE WHEN first_segment_at IS NULL THEN 0 ELSE MAX(0, COALESCE(ended_at, ?) - first_segment_at) END) AS stream_ms,
				        SUM(delivered_bytes) AS delivered, SUM(edge_requests) AS requests, SUM(stored_bytes) AS stored,
				        SUM(viewer_seconds) AS viewer_seconds
				   FROM live_sessions WHERE created_at >= ? GROUP BY provider`,
			)
			.bind(now, monthStart)
			.all<{ provider: LiveProviderId; stream_ms: number; delivered: number; requests: number; stored: number; viewer_seconds: number }>(),
	]);
	const out = {} as Record<LiveProviderId, Omit<LiveProviderUsage, 'available'>>;
	for (const p of LIVE_PROVIDERS) {
		const m = (month ?? []).find((r) => r.provider === p);
		out[p] = {
			active: (active ?? []).find((r) => r.provider === p)?.n ?? 0,
			monthSpendUsd: m ? estimateCost(settings, p, { streamMs: m.stream_ms ?? 0, deliveredBytes: m.delivered ?? 0, edgeRequests: m.requests ?? 0, storedBytes: m.stored ?? 0 }) : 0,
		};
	}
	return out;
}

const GB = 1e9;

/** Cost estimate (USD) from cost units and the configured rates. */
export function estimateCost(
	settings: Pick<LiveRoutingSettings, 'rates'>,
	provider: LiveProviderId,
	u: { streamMs: number; deliveredBytes: number; edgeRequests: number; storedBytes: number },
): number {
	const r = settings.rates[provider];
	return (
		(u.streamMs / 3_600_000) * r.perStreamHourUsd +
		(u.deliveredBytes / GB) * r.perDeliveredGbUsd +
		(u.edgeRequests / 1e6) * r.perMillionRequestsUsd +
		(u.storedBytes / GB) * r.perStoredGbMonthUsd
	);
}
