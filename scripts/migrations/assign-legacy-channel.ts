/**
 * Moves the legacy imported videos of one channel name onto a real channel
 * (issue #245). Legacy videos have `channelId: null`, the placeholder owner
 * d3b07384-… and the channel only as a display name in `channel`, so channel
 * pages, subscriptions, rollups and owner analytics were empty for them.
 *
 *   npx tsx scripts/migrations/assign-legacy-channel.ts --env qa|production \
 *     --owner <auth user id> --channel-name "Mostafa Elbadry" [--apply] [--backup-dir <dir>]
 *
 * Dry run unless --apply. Idempotent: a re-run finds the channel it created
 * (by owner + name in the ownership index, or by its claimed handle), skips
 * videos already moved, re-syncs their index rows, and adds no rollup twice.
 *
 * With --apply, in order:
 *  1. Every video to change is backed up (as read) to <backup-dir>/videos/<id>.json
 *     and to the messages bucket under migrations/issue-245/<env>/<run>/videos/<id>.json.
 *  2. The channel is created if the owner has none with that name: same record
 *     as api-videos ChannelCreate (isMain false, default @handle claimed in the
 *     channel-tabs index, avatar = the legacy channel thumbnail of the videos),
 *     plus its ownership and search index rows.
 *  3. Each video gets `channelId` and `userId` (re-read just before the write so
 *     a view counted meanwhile is kept), then its ownership and search rows are
 *     re-projected with the shared projections (packages/shared-types search).
 *  4. Rollups (D1 analytics_daily) of the moved videos are rebuilt from the
 *     message archive with the processor's own increment functions, and the
 *     channel's rows are set to the sum of its videos (see legacy-channel.ts
 *     rollupDeltas).
 *
 * QA has no legacy data: `--make-fixture <n>` (QA only) copies n legacy videos
 * from production (read-only) into the QA buckets with archived views, so the
 * migration can be proven on QA first. Fixture videos carry `qaFixture: "issue-245"`.
 *
 * `--archive-prefixes 2025-11,2026-03` limits the archive scan to those key
 * prefixes (the QA archive holds over a million E2E messages; prod's is small,
 * so prod scans it all, the default).
 *
 * Credentials: CLOUDFLARE_API_TOKEN (R2 + D1 edit) or the `wrangler login` token.
 * Requests are paced and retried on 429, since the token's API quota is shared.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { cfToken, DEFAULT_ACCOUNT_ID } from '../release/cf-api.ts';
import { parseJsonc } from '../release/jsonc.ts';
import {
	OWNERSHIP_TABLE,
	ownershipCompleteKey,
	syncOwnership,
	syncSearchDocument,
	type SearchDb,
} from '../../packages/shared-types/src/search/index';
import { MessageType } from '../../packages/shared-types/src/queue';
import {
	docIncrements,
	isTrackedView,
	parseRollupKey,
	viewIncrements,
	watchTimeIncrements,
} from '../../apps/processor/src/lib/analytics-rollup';
import { bulkUpsertStatements } from '../../apps/processor/src/lib/analytics-counters';
import {
	LEGACY_PLACEHOLDER_USER,
	backupKey,
	buildChannel,
	handleCandidates,
	handleKey,
	isLegacyCandidate,
	isMigrated,
	migrateVideo,
	pickAvatar,
	rollupDeltas,
	sumRows,
	type CounterRow,
	type Json,
	type LegacyMatch,
	type Target,
} from './legacy-channel.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
type Env = 'qa' | 'production';

// ---------------------------------------------------------------------------
// Paced Cloudflare REST client
// ---------------------------------------------------------------------------

class Api {
	private last = 0;
	requests = 0;
	constructor(private token: string, readonly account: string, private gapMs: number) {}

	async fetch(method: string, path: string, init: { body?: string; contentType?: string } = {}): Promise<Response> {
		for (let attempt = 0; ; attempt++) {
			const wait = this.last + this.gapMs - Date.now();
			if (wait > 0) await sleep(wait);
			this.last = Date.now();
			this.requests++;
			const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.account}${path}`, {
				method,
				headers: { Authorization: `Bearer ${this.token}`, ...(init.contentType ? { 'Content-Type': init.contentType } : {}) },
				body: init.body,
			}).catch((error) => ({ ok: false, status: 599, error }) as unknown as Response);
			if ((res.status === 429 || res.status >= 500) && attempt < 10) {
				const backoff = Math.min(120_000, 5_000 * 2 ** attempt);
				console.warn(`  ${res.status} on ${method} ${path.split('?')[0]}; retrying in ${backoff / 1000}s`);
				await sleep(backoff);
				continue;
			}
			return res;
		}
	}

	async json<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await this.fetch(method, path, body === undefined ? {} : { body: JSON.stringify(body), contentType: 'application/json' });
		const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; result_info?: unknown; errors?: { message: string }[] };
		if (!res.ok || json.success === false) throw new Error(`${method} ${path.split('?')[0]} -> ${res.status} ${json.errors?.map((e) => e.message).join('; ') ?? ''}`);
		return json as T;
	}

	async r2Get(bucket: string, key: string): Promise<string | null> {
		const res = await this.fetch('GET', `/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`);
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`GET r2 ${bucket}/${key} -> ${res.status}`);
		return res.text();
	}

	async r2Put(bucket: string, key: string, text: string): Promise<void> {
		const res = await this.fetch('PUT', `/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`, { body: text, contentType: 'application/json' });
		if (!res.ok) throw new Error(`PUT r2 ${bucket}/${key} -> ${res.status} ${await res.text().catch(() => '')}`);
	}

	async r2List(bucket: string, prefix = ''): Promise<{ key: string; custom_metadata?: Record<string, string> }[]> {
		const out: { key: string; custom_metadata?: Record<string, string> }[] = [];
		let cursor = '';
		do {
			const qs = new URLSearchParams({ per_page: '1000', ...(prefix ? { prefix } : {}), ...(cursor ? { cursor } : {}) });
			const page = await this.json<{ result: typeof out; result_info?: { cursor?: string; is_truncated?: boolean } }>('GET', `/r2/buckets/${bucket}/objects?${qs}`);
			out.push(...page.result);
			cursor = page.result_info?.is_truncated ? page.result_info.cursor ?? '' : '';
		} while (cursor);
		return out;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** D1 over REST with the Worker binding's API (prepare/bind/first/all/run/batch). */
function restD1(api: Api, databaseId: string): SearchDb & { exec(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> } {
	type Q = { sql: string; params: unknown[] };
	type R = { results: Record<string, unknown>[]; meta: { changes?: number } };
	const send = async (batch: Q[]): Promise<R[]> => {
		const body = batch.length === 1 ? batch[0] : { batch };
		const out = await api.json<{ result: R[] }>('POST', `/d1/database/${databaseId}/query`, body);
		return out.result;
	};
	const stmt = (sql: string, params: unknown[]): any => ({
		sql,
		params,
		bind: (...p: unknown[]) => stmt(sql, p.map((v) => (typeof v === 'boolean' ? Number(v) : v === undefined ? null : v))),
		first: async () => (await send([{ sql, params }]))[0]?.results?.[0] ?? null,
		all: async () => ({ results: (await send([{ sql, params }]))[0]?.results ?? [] }),
		run: async () => (await send([{ sql, params }]))[0],
	});
	return {
		prepare: (sql: string) => stmt(sql, []),
		batch: async (list: { sql: string; params: unknown[] }[]) => (list.length ? send(list.map((s) => ({ sql: s.sql, params: s.params }))) : []),
		exec: async (sql: string, params: unknown[] = []) => (await send([{ sql, params }]))[0]?.results ?? [],
	} as any;
}

// ---------------------------------------------------------------------------
// Environment targets (from the api-videos wrangler configs)
// ---------------------------------------------------------------------------

interface Targets {
	videos: string;
	channels: string;
	profiles: string;
	channelTabs: string;
	messages: string;
	searchDb: string;
	notificationsDb: string;
}

export function targets(env: Env): Targets {
	const file = env === 'qa' ? 'wrangler.qa.jsonc' : 'wrangler.jsonc';
	const cfg = parseJsonc(readFileSync(join(ROOT, 'apps', 'api-videos', file), 'utf8')) as any;
	const bucket = (binding: string) => {
		const name = cfg.r2_buckets.find((b: any) => b.binding === binding)?.bucket_name;
		if (!name) throw new Error(`${file}: no R2 binding ${binding}`);
		return name as string;
	};
	const db = (binding: string) => {
		const id = cfg.d1_databases.find((d: any) => d.binding === binding)?.database_id;
		if (!id) throw new Error(`${file}: no D1 binding ${binding}`);
		return id as string;
	};
	return {
		videos: bucket('videos'),
		channels: bucket('channels'),
		profiles: bucket('profiles'),
		channelTabs: bucket('channel_tabs'),
		messages: bucket('analytics_rollups'),
		searchDb: db('SEARCH_DB'),
		notificationsDb: db('NOTIFICATIONS_DB'),
	};
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | true> {
	const out: Record<string, string | true> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith('--')) {
			out[a.slice(2)] = next;
			i++;
		} else out[a.slice(2)] = true;
	}
	return out;
}

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i], i);
		}
	}));
	return out;
}

function parse(text: string | null): Json | null {
	if (!text) return null;
	try {
		const v = JSON.parse(text);
		return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
	} catch {
		return null;
	}
}

/** The owner's not-deleted channel with this name, or the one a previous run claimed a handle for. */
async function findChannel(api: Api, t: Targets, search: ReturnType<typeof restD1>, ownerId: string, name: string): Promise<Json | null> {
	const complete = await search.exec('SELECT value FROM search_meta WHERE key = ?', [ownershipCompleteKey('channel')]);
	if (!complete.length) throw new Error('channel ownership index is incomplete; run the ownership pass first (it would hide existing channels)');
	const rows = await search.exec(`SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND owner_id = ? AND is_deleted = 0 ORDER BY id`, [ownerId]);
	for (const { id } of rows) {
		const ch = parse(await api.r2Get(t.channels, String(id)));
		if (ch && !ch.isDeleted && String(ch.name ?? '').trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()) return ch;
	}
	return null;
}

async function claimHandle(api: Api, t: Targets, channel: { id: string; userId: string; name: string }): Promise<string | undefined> {
	for (const handle of handleCandidates(channel.name, channel.id)) {
		const key = handleKey(handle);
		const existing = parse(await api.r2Get(t.channelTabs, key));
		if (existing) {
			if (existing.channelId === channel.id) return String(existing.handle);
			continue;
		}
		await api.r2Put(t.channelTabs, key, JSON.stringify({ handle, channelId: channel.id, userId: channel.userId, dateClaimed: new Date().toISOString() }));
		const back = parse(await api.r2Get(t.channelTabs, key));
		if (back?.channelId === channel.id) return handle;
	}
	console.warn('  no default handle available; the owner can set one in channel settings');
	return undefined;
}

/** A handle claimed by an interrupted earlier run (channel object never written). */
async function orphanClaim(api: Api, t: Targets, ownerId: string, name: string): Promise<string | null> {
	const base = handleCandidates(name, '')[0];
	if (!base) return null;
	const entry = parse(await api.r2Get(t.channelTabs, handleKey(base)));
	if (!entry || entry.userId !== ownerId || typeof entry.channelId !== 'string') return null;
	const ch = await api.r2Get(t.channels, entry.channelId);
	return ch ? null : entry.channelId;
}

async function syncIndexes(search: SearchDb, type: 'video' | 'channel', id: string, object: Json): Promise<void> {
	const version = Date.now();
	await syncOwnership(search, type, id, object, version, version);
	await syncSearchDocument(search, type, id, object, { version });
}

interface ArchivedMessage {
	type?: number;
	typeName?: string;
	timestamp?: number | string;
	payload?: Record<string, unknown>;
}

const ARCHIVE_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\./;

async function rebuildRollups(
	api: Api,
	t: Targets,
	videoIds: Set<string>,
	channelId: string,
	apply: boolean,
	archivePrefixes: string[],
): Promise<{ archived: number; deltas: CounterRow[] }> {
	const notifications = restD1(api, t.notificationsDb);
	const all: { key: string; custom_metadata?: Record<string, string> }[] = [];
	for (const prefix of ['analytics/rollups/', ...(archivePrefixes.length ? archivePrefixes : [''])]) {
		for (const o of await api.r2List(t.messages, prefix)) if (prefix || !o.key.startsWith('analytics/rollups/')) all.push(o);
	}
	const wanted = new Set(['VideoView', 'VideoWatchTime']);
	const archiveKeys = all.filter((o) => ARCHIVE_KEY.test(o.key) && (!o.custom_metadata?.messageType || wanted.has(o.custom_metadata.messageType)));
	const archiveRows: CounterRow[] = [];
	let archived = 0;
	await pool(archiveKeys, 4, async (o) => {
		const msg = parse(await api.r2Get(t.messages, o.key)) as ArchivedMessage | null;
		const p = msg?.payload;
		if (!msg || !p || typeof p.videoId !== 'string' || !videoIds.has(p.videoId)) return;
		const ts = msg.timestamp ?? 0;
		let incs: CounterRow[] | null = null;
		if (msg.type === MessageType.VideoView || msg.typeName === 'VideoView') {
			if (!isTrackedView(p as never)) return;
			incs = viewIncrements({ ...p, videoChannelId: null } as never, ts) as CounterRow[] | null;
		} else if (msg.type === MessageType.VideoWatchTime || msg.typeName === 'VideoWatchTime') {
			incs = watchTimeIncrements({ ...p, videoChannelId: null } as never, ts) as CounterRow[] | null;
		}
		if (incs?.length) {
			archived++;
			archiveRows.push(...incs.filter((r) => r.entityType === 'video'));
		}
	});

	// What readers see now: D1 rows + legacy R2 documents not imported yet
	const effectiveRows: CounterRow[] = [];
	const ids = [...videoIds];
	for (let i = 0; i < ids.length; i += 90) {
		const chunk = ids.slice(i, i + 90);
		const rows = await notifications.exec(
			`SELECT entity_type, entity_id, day, metric, dim, value FROM analytics_daily WHERE entity_type = 'video' AND entity_id IN (${chunk.map(() => '?').join(', ')})`,
			chunk,
		);
		effectiveRows.push(...rows.map(toRow));
	}
	if (channelId) {
		const rows = await notifications.exec(`SELECT entity_type, entity_id, day, metric, dim, value FROM analytics_daily WHERE entity_type = 'channel' AND entity_id = ?`, [channelId]);
		effectiveRows.push(...rows.map(toRow));
	}
	const legacyDocs = all
		.map((o) => ({ key: o.key, parsed: parseRollupKey(o.key) }))
		.filter((d) => d.parsed && (d.parsed.entityType === 'video' ? videoIds.has(d.parsed.entityId) : d.parsed.entityId === channelId));
	for (const doc of legacyDocs) {
		const imported = await notifications.exec('SELECT r2_key FROM analytics_rollup_imports WHERE r2_key = ?', [doc.key]);
		if (imported.length) continue;
		const body = parse(await api.r2Get(t.messages, doc.key));
		if (body) effectiveRows.push(...(docIncrements(body as never, doc.parsed!.entityType, doc.parsed!.entityId, doc.parsed!.month) as CounterRow[]));
	}

	const deltas = rollupDeltas(sumRows(archiveRows), sumRows(effectiveRows), channelId || 'NEW-CHANNEL', videoIds);
	if (apply && channelId && deltas.length) {
		for (const s of bulkUpsertStatements(notifications as never, deltas as never)) await (s as any).run();
	}
	return { archived, deltas };
}

function toRow(r: Record<string, unknown>): CounterRow {
	return {
		entityType: r.entity_type as CounterRow['entityType'],
		entityId: String(r.entity_id),
		day: String(r.day),
		metric: String(r.metric),
		dim: String(r.dim ?? ''),
		value: Number(r.value) || 0,
	};
}

// ---------------------------------------------------------------------------
// QA fixture
// ---------------------------------------------------------------------------

async function makeFixture(api: Api, t: Targets, count: number, match: LegacyMatch): Promise<void> {
	const prod = targets('production');
	const search = restD1(api, t.searchDb);
	const keys = (await api.r2List(prod.videos)).map((o) => o.key).filter((k) => !k.includes('/') && !k.includes(':'));
	let made = 0;
	for (const key of keys) {
		if (made >= count) break;
		const video = parse(await api.r2Get(prod.videos, key));
		if (!video || !isLegacyCandidate(video, match)) continue;
		const fixture = { ...video, qaFixture: 'issue-245' };
		if (!(await api.r2Get(t.videos, key))) {
			await api.r2Put(t.videos, key, JSON.stringify(fixture));
			await syncIndexes(search, 'video', key, fixture);
		}
		// Two archived views a year back (before the D1 rollups existed) and one recent
		for (const [i, iso] of ['2025-11-09T04:22:45.000Z', '2025-11-09T05:10:00.000Z', '2026-03-07T10:00:00.000Z'].entries()) {
			const id = `fixture-245-${key.slice(0, 8)}-${i}`;
			const ts = Date.parse(iso);
			const msg = {
				id,
				type: MessageType.VideoView,
				payload: { videoId: key, videoChannelId: null, timestamp: iso, source: 'watch' },
				timestamp: ts,
				typeName: 'VideoView',
				timestampISO: iso,
			};
			await api.r2Put(t.messages, `${iso.slice(0, 19).replace(/:/g, '-')}.${id}`, JSON.stringify(msg));
		}
		made++;
		console.log(`  fixture video ${key}: ${String(video.title).slice(0, 60)}`);
	}
	console.log(`Fixture: ${made} legacy videos (channel "${match.channelName}") with 3 archived views each in ${t.videos}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const env = args.env as Env;
	if (env !== 'qa' && env !== 'production') throw new Error('--env qa|production is required');
	const token = cfToken();
	if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
	const api = new Api(token, process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID, Number(args['gap-ms'] ?? 250));
	const t = targets(env);
	const match: LegacyMatch = {
		channelName: String(args['channel-name'] ?? 'Mostafa Elbadry'),
		legacyUserId: String(args['legacy-user'] ?? LEGACY_PLACEHOLDER_USER),
	};

	if (args['make-fixture']) {
		if (env !== 'qa') throw new Error('--make-fixture is QA only');
		await makeFixture(api, t, Number(args['make-fixture']) || 5, match);
		return;
	}

	const ownerId = String(args.owner ?? '');
	if (!/^usr_[0-9a-f]{32}$/.test(ownerId)) throw new Error('--owner <auth user id usr_…> is required');
	const apply = args.apply === true;
	// Archive keys start with the UTC date (YYYY-MM-DDT…). Default: the whole archive.
	const archivePrefixes = typeof args['archive-prefixes'] === 'string' ? args['archive-prefixes'].split(',').map((p) => p.trim()).filter(Boolean) : [];
	const runId = new Date().toISOString().replace(/[:.]/g, '-');
	const backupDir = resolve(String(args['backup-dir'] ?? join('.migration-backups', 'issue-245', env, runId)));
	console.log(`${apply ? 'APPLY' : 'DRY RUN'} on ${env}: videos of "${match.channelName}" (owner ${match.legacyUserId}) -> owner ${ownerId}`);

	const search = restD1(api, t.searchDb);
	const profile = parse(await api.r2Get(t.profiles, ownerId));
	if (!profile) throw new Error(`owner ${ownerId} has no profile in ${t.profiles}`);

	let channel = await findChannel(api, t, search, ownerId, match.channelName);
	const orphanId = channel ? null : await orphanClaim(api, t, ownerId, match.channelName);
	console.log(channel ? `Channel exists: ${channel.id} @${channel.handle ?? '-'}` : `Channel "${match.channelName}" will be created${orphanId ? ` (reusing id ${orphanId} from an interrupted run)` : ''}`);

	// Scan the videos bucket
	const keys = (await api.r2List(t.videos)).map((o) => o.key).filter((k) => !k.includes('/') && !k.includes(':'));
	const videos = (await pool(keys, 4, async (k) => ({ key: k, text: await api.r2Get(t.videos, k) }))).filter((v) => v.text);
	const candidates: { key: string; text: string; video: Json }[] = [];
	const migrated: { key: string; video: Json }[] = [];
	const otherLegacy = new Map<string, number>();
	for (const { key, text } of videos) {
		const video = parse(text);
		if (!video) continue;
		if (isLegacyCandidate(video, match)) candidates.push({ key, text: text!, video });
		else if (channel && isMigrated(video, { channelId: String(channel.id), ownerId })) migrated.push({ key, video });
		else if (!video.channelId) otherLegacy.set(String(video.channel ?? '(none)'), (otherLegacy.get(String(video.channel ?? '(none)')) ?? 0) + 1);
	}
	const avatarUrl = channel?.avatarUrl ? String(channel.avatarUrl) : (args.avatar as string | undefined) ?? pickAvatar(candidates.map((c) => c.video));
	console.log(`Videos: ${videos.length} scanned, ${candidates.length} to move, ${migrated.length} already moved`);
	if (otherLegacy.size) console.log(`Other videos without a channel (left alone): ${JSON.stringify(Object.fromEntries(otherLegacy))}`);
	if (!channel) console.log(`New channel avatar: ${avatarUrl ?? '(default)'}; handle candidates: ${handleCandidates(match.channelName, orphanId ?? '0000000000000000').slice(0, 2).join(', ')}…`);

	if (!apply) {
		const ids = new Set([...candidates, ...migrated].map((v) => v.key));
		const { archived, deltas } = await rebuildRollups(api, t, ids, channel ? String(channel.id) : '', false, archivePrefixes);
		console.log(`Rollups: ${archived} archived view/watch-time messages for these videos; ${deltas.length} counter rows would be added`);
		for (const d of deltas.slice(0, 20)) console.log(`  + ${d.entityType} ${d.entityId.slice(0, 8)} ${d.day} ${d.metric}${d.dim ? `/${d.dim}` : ''} ${d.value}`);
		console.log(`Dry run only (${api.requests} API requests). Re-run with --apply to write.`);
		return;
	}

	// 1. Backups of every video that will change, before any write
	mkdirSync(join(backupDir, 'videos'), { recursive: true });
	const manifest = join(backupDir, 'manifest.ndjson');
	await pool(candidates, 4, async (c) => {
		writeFileSync(join(backupDir, 'videos', `${c.key}.json`), c.text);
		await api.r2Put(t.messages, backupKey(env, runId, 'videos', c.key), c.text);
		appendFileSync(manifest, JSON.stringify({ bucket: t.videos, key: c.key, backup: backupKey(env, runId, 'videos', c.key) }) + '\n');
	});
	console.log(`Backed up ${candidates.length} videos to ${backupDir} and ${t.messages}/${backupKey(env, runId, 'videos', '').replace(/\.json$/, '')}`);

	// 2. Channel
	if (!channel) {
		const id = orphanId ?? randomUUID();
		const handle = await claimHandle(api, t, { id, userId: ownerId, name: match.channelName });
		channel = buildChannel({ id, now: new Date().toISOString(), ownerId, email: String(profile.email ?? ''), name: match.channelName, avatarUrl, handle });
		await api.r2Put(t.channels, id, JSON.stringify(channel));
		console.log(`Created channel ${id} @${handle ?? '-'}`);
	}
	await syncIndexes(search, 'channel', String(channel.id), channel);
	const target: Target = { channelId: String(channel.id), ownerId };

	// 3. Videos
	let moved = 0;
	let resynced = 0;
	await pool(candidates, 3, async (c, i) => {
		const freshText = await api.r2Get(t.videos, c.key);
		const fresh = parse(freshText);
		if (!fresh) return;
		const next = migrateVideo(fresh, match, target);
		if (!next) {
			if (isMigrated(fresh, target)) await syncIndexes(search, 'video', c.key, fresh);
			return;
		}
		if (freshText !== c.text) {
			// Changed since the backup (a view): keep that copy too
			writeFileSync(join(backupDir, 'videos', `${c.key}.pre-write.json`), freshText!);
			await api.r2Put(t.messages, backupKey(env, runId, 'videos', `${c.key}.pre-write`), freshText!);
		}
		await api.r2Put(t.videos, c.key, JSON.stringify(next));
		await syncIndexes(search, 'video', c.key, next);
		moved++;
		if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${candidates.length}`);
	});
	for (const m of migrated) {
		await syncIndexes(search, 'video', m.key, m.video);
		resynced++;
	}
	console.log(`Moved ${moved} videos; re-synced indexes of ${resynced} already moved`);

	// 4. Rollups
	const ids = new Set([...candidates, ...migrated].map((v) => v.key));
	const { archived, deltas } = await rebuildRollups(api, t, ids, target.channelId, true, archivePrefixes);
	console.log(`Rollups: ${archived} archived messages; added ${deltas.length} counter rows (${deltas.filter((d) => d.entityType === 'channel').length} channel)`);

	// Verification
	const [own] = await search.exec(`SELECT COUNT(*) AS n FROM ${OWNERSHIP_TABLE} WHERE kind = 'video' AND channel_id = ? AND owner_id = ? AND is_deleted = 0`, [target.channelId, ownerId]);
	const [found] = await search.exec(`SELECT COUNT(*) AS n FROM search_videos WHERE channel_id = ?`, [target.channelId]).catch(() => [{ n: '?' }]);
	console.log(`Verify: ownership rows for the channel ${own?.n}; search rows ${found?.n}; ${api.requests} API requests`);
	writeFileSync(join(backupDir, 'result.json'), JSON.stringify({ env, runId, channel, moved, resynced, archived, deltas }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
