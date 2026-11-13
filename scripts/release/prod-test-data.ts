/**
 * Production test data: which records are test leftovers, how to delete one test
 * account from every store, and a scan that lists whatever is left.
 *
 * Used by delete-test-user.ts (deletes the accounts a prod check listed) and
 * check-prod-test-data.ts (the guard that fails CI when anything is left).
 *
 * A test account is an address on a test inbox: <slug>@delivered.resend.dev with a
 * `test-` slug (Resend's test inbox, which every prod check and probe registers
 * with), or anything @e2e.alummahnow.net (the QA/stage code sink, never valid on
 * production). Nothing else is ever deleted.
 *
 * Stores one account touches, all in the production Cloudflare account:
 * - auth D1 `users` (identities, refresh tokens, codes cascade), `rbac_user_roles`,
 *   `account_sessions`, `browser_sessions.active_user_id`
 * - auth KV (openauth joins key parts with "::"): `email::<e>::password|subject`,
 *   `user::email::default::<e>`, `user::default::<usr>`, `oauth:refresh::<subject>::*`,
 *   `session:<uuid>` whose user is the account
 * - api-videos R2: `profiles/<usr>`, `watch-history/<usr>:*`, the user's channels
 *   (`channels/<id>`, its handle `channel-tabs/channel-handles/<handle>`, tab config
 *   `channel-tabs/channel-tabs/<id>`, sections `channel-sections/<id>/*`)
 * - api-videos search D1: the channels' search rows (+ FTS) and ownership rows,
 *   with a tombstone so an older snapshot cannot re-index them
 * A test account that owns videos or playlists is refused: those carry Bunny media
 * and need the API's own delete (DELETE /api/privacy/data as the user).
 */
import { cfToken, DEFAULT_ACCOUNT_ID } from './cf-api.ts';

/** Production auth server storage (AlUmmahNowAuth apps/auth/wrangler.json, env.production). */
export const AUTH_PROD = { d1: 'af76f007-e21e-43aa-88de-ebfefe46fb56', kv: 'c3f796d40db8420c920aef1ce10a7f13' };
/** Production api-videos search index (apps/api-videos/wrangler.jsonc, SEARCH_DB). */
export const SEARCH_PROD = { d1: '41064871-cf1f-46e9-b102-7b913240ad89' };
/** Production api-videos buckets (apps/api-videos/wrangler.jsonc, top level). */
export const BUCKETS = {
	profiles: 'profiles',
	channels: 'channels',
	channelTabs: 'channel-tabs',
	channelSections: 'channel-sections',
	watchHistory: 'watch-history',
} as const;

/** openauth's key separator (openauth packages/openauth/src/storage/storage.ts SEPARATOR). */
export const KV_SEP = '::';

export const TEST_ADDRESS = /^(?:test-[a-z0-9]+(?:-[a-z0-9]+)*@delivered\.resend\.dev|[a-z0-9][a-z0-9.+_-]*@e2e\.alummahnow\.net)$/;

export function isTestAddress(email: unknown): email is string {
	return typeof email === 'string' && TEST_ADDRESS.test(email);
}

export function assertTestAddress(email: string): void {
	if (!isTestAddress(email)) throw new Error(`refusing to delete ${JSON.stringify(email)}: not a production test account`);
}

export const USER_ID = /^usr_[0-9a-f]{32}$/;

export function assertUserId(userId: string): void {
	if (!USER_ID.test(userId)) throw new Error(`refusing ${JSON.stringify(userId)}: not an auth user id`);
}

/** Exact auth KV keys of one account. */
export function kvKeys(email: string, userId?: string): string[] {
	const keys = [`email${KV_SEP}${email}${KV_SEP}password`, `email${KV_SEP}${email}${KV_SEP}subject`, `user${KV_SEP}email${KV_SEP}default${KV_SEP}${email}`];
	if (userId) keys.push(`user${KV_SEP}default${KV_SEP}${userId}`);
	return keys;
}

/** Prefix of an openauth subject's refresh tokens (`user:<hex>`, from email::<e>::subject). */
export function refreshPrefix(subject: string): string {
	if (!/^user:[0-9a-f]{16}$/.test(subject)) throw new Error(`refusing refresh tokens of ${JSON.stringify(subject)}: not an openauth subject`);
	return `oauth:refresh${KV_SEP}${subject}${KV_SEP}`;
}

/**
 * The auth user id a session (`{user:{id}}`) or refresh token (`{properties:{id}}`,
 * `{subjectProperties:{id}}`) value belongs to; undefined when it names none.
 */
export function kvValueUserId(value: string): string | undefined {
	try {
		const v = JSON.parse(value) as Record<string, { id?: unknown } | undefined>;
		for (const field of ['user', 'properties', 'subjectProperties', 'props']) {
			const id = v[field]?.id;
			if (typeof id === 'string' && USER_ID.test(id)) return id;
		}
	} catch {
		// not JSON: names no user
	}
	return undefined;
}

/** Auth D1 statements that delete one user; rows without an FK to users first. */
export function authDeleteStatements(userId: string): { sql: string; params: string[] }[] {
	assertUserId(userId);
	return [
		{ sql: 'DELETE FROM rbac_user_roles WHERE user_id = ?', params: [userId] },
		{ sql: 'DELETE FROM account_sessions WHERE user_id = ?', params: [userId] },
		{ sql: 'UPDATE browser_sessions SET active_user_id = NULL WHERE active_user_id = ?', params: [userId] },
		{ sql: 'DELETE FROM users WHERE id = ?', params: [userId] },
	];
}

/** Search D1 statements that drop one channel (search row, FTS row, ownership) and tombstone it. */
export function searchChannelDeleteStatements(channelId: string, now: number): { sql: string; params: (string | number)[] }[] {
	if (!/^[0-9a-f-]{36}$/.test(channelId)) throw new Error(`refusing channel ${JSON.stringify(channelId)}: not a channel id`);
	const tomb = 'INSERT INTO search_tombstones (entity, id, version) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET version = max(version, excluded.version)';
	return [
		{ sql: tomb, params: ['channel', channelId, now] },
		{ sql: tomb, params: ['own:channel', channelId, now] },
		{ sql: 'DELETE FROM search_channels_fts WHERE rowid = (SELECT rowid FROM search_channels WHERE id = ?)', params: [channelId] },
		{ sql: 'DELETE FROM search_channels WHERE id = ?', params: [channelId] },
		{ sql: "DELETE FROM content_ownership WHERE kind = 'channel' AND id = ?", params: [channelId] },
	];
}

/** Search D1 statements that drop a user's admin-directory profile row and tombstone it. */
export function searchProfileDeleteStatements(userId: string, now: number): { sql: string; params: (string | number)[] }[] {
	if (!USER_ID.test(userId)) throw new Error(`refusing profile ${JSON.stringify(userId)}: not a user id`);
	return [
		{ sql: 'INSERT INTO search_tombstones (entity, id, version) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET version = max(version, excluded.version)', params: ['own:profile', userId, now] },
		{ sql: "DELETE FROM content_ownership WHERE kind = 'profile' AND id = ?", params: [userId] },
	];
}

/** R2 keys of one channel (handle only when the handle entry points at this channel). */
export function channelKeys(channel: { id: string; handle?: string }, sectionKeys: string[]): { bucket: string; key: string }[] {
	const keys = [
		{ bucket: BUCKETS.channels, key: channel.id },
		{ bucket: BUCKETS.channelTabs, key: `channel-tabs/${channel.id}` },
		...sectionKeys.filter((k) => k.startsWith(`${channel.id}/`)).map((key) => ({ bucket: BUCKETS.channelSections, key })),
	];
	if (channel.handle) keys.push({ bucket: BUCKETS.channelTabs, key: `channel-handles/${channel.handle.toLowerCase()}` });
	return keys;
}

// ---------------------------------------------------------------------------
// Cloudflare REST access

export interface Cf {
	/** The `result` of a JSON API call. */
	json<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
	/** The whole JSON envelope (for list calls, whose cursor is in `result_info`). */
	envelope<T>(path: string): Promise<{ result: T; result_info?: { cursor?: string; is_truncated?: boolean } }>;
	raw(path: string, method?: string): Promise<{ status: number; body: string }>;
}

export function createCf(env: NodeJS.ProcessEnv = process.env): Cf {
	const token = cfToken(env);
	if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
	const api = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID}`;
	const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	const send = async (path: string, init: RequestInit, attempt = 0): Promise<Response> => {
		const res = await fetch(`${api}${path}`, { ...init, headers });
		// 429 and D1's 971 ("please wait") are rate limits: back off and retry
		if ((res.status === 429 || res.status === 503) && attempt < 6) {
			await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
			return send(path, init, attempt + 1);
		}
		return res;
	};
	type Envelope<T> = { success: boolean; errors?: { code?: number }[]; result: T; result_info?: { cursor?: string; is_truncated?: boolean } };
	const call = async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<Envelope<T>> => {
		for (let attempt = 0; ; attempt++) {
			const res = await send(path, { method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body) });
			const body = (await res.json()) as Envelope<T>;
			if (!body.success && body.errors?.some((e) => e.code === 971) && attempt < 6) {
				await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
				continue;
			}
			if (!body.success) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${JSON.stringify(body.errors)}`);
			return body;
		}
	};
	return {
		json: async <T>(path: string, init?: { method?: string; body?: unknown }) => (await call<T>(path, init)).result,
		envelope: <T>(path: string) => call<T>(path),
		async raw(path: string, method = 'GET') {
			const res = await send(path, { method });
			return { status: res.status, body: await res.text() };
		},
	};
}

const enc = encodeURIComponent;

export async function d1(cf: Cf, db: string, sql: string, params: (string | number)[] = []): Promise<Record<string, unknown>[]> {
	return (await cf.json<{ results: Record<string, unknown>[] }[]>(`/d1/database/${db}/query`, { method: 'POST', body: { sql, params } }))[0].results;
}

export async function kvList(cf: Cf, prefix = ''): Promise<string[]> {
	const names: string[] = [];
	let cursor = '';
	do {
		const page = await cf.envelope<{ name: string }[]>(
			`/storage/kv/namespaces/${AUTH_PROD.kv}/keys?limit=1000${prefix ? `&prefix=${enc(prefix)}` : ''}${cursor ? `&cursor=${enc(cursor)}` : ''}`,
		);
		names.push(...page.result.map((k) => k.name));
		cursor = page.result_info?.cursor ?? '';
	} while (cursor);
	return names;
}

export async function kvGet(cf: Cf, key: string): Promise<string | null> {
	const r = await cf.raw(`/storage/kv/namespaces/${AUTH_PROD.kv}/values/${enc(key)}`);
	return r.status === 200 ? r.body : null;
}

export async function kvDelete(cf: Cf, key: string): Promise<void> {
	await cf.json(`/storage/kv/namespaces/${AUTH_PROD.kv}/values/${enc(key)}`, { method: 'DELETE' });
}

export async function r2List(cf: Cf, bucket: string, prefix = ''): Promise<string[]> {
	const keys: string[] = [];
	let cursor = '';
	for (;;) {
		const page = await cf.envelope<{ key: string }[]>(
			`/r2/buckets/${bucket}/objects?per_page=1000${prefix ? `&prefix=${enc(prefix)}` : ''}${cursor ? `&cursor=${enc(cursor)}` : ''}`,
		);
		keys.push(...page.result.map((o) => o.key));
		cursor = page.result_info?.cursor ?? '';
		if (!page.result_info?.is_truncated || !cursor) return keys;
	}
}

export async function r2GetJson<T>(cf: Cf, bucket: string, key: string): Promise<T | null> {
	const r = await cf.raw(`/r2/buckets/${bucket}/objects/${enc(key)}`);
	if (r.status === 404) return null;
	if (r.status !== 200) throw new Error(`reading ${bucket}/${key}: HTTP ${r.status}`);
	try {
		return JSON.parse(r.body) as T;
	} catch {
		return null;
	}
}

export async function r2Delete(cf: Cf, bucket: string, key: string): Promise<void> {
	const del = await cf.raw(`/r2/buckets/${bucket}/objects/${enc(key)}`, 'DELETE');
	if ((del.status < 200 || del.status > 299) && del.status !== 404) throw new Error(`deleting ${bucket}/${key}: HTTP ${del.status}`);
	const left = await cf.raw(`/r2/buckets/${bucket}/objects/${enc(key)}`);
	if (left.status !== 404) throw new Error(`${bucket}/${key} still readable after delete (HTTP ${left.status})`);
}

// ---------------------------------------------------------------------------
// Delete one test account everywhere

export interface DeleteReport {
	email?: string;
	userId?: string;
	kv: number;
	r2: number;
	channels: number;
	authRows: boolean;
}

/**
 * Deletes one test account from every store. Give the email (looked up in auth
 * D1/KV) and/or the user id (an account whose D1 row is already gone).
 * Throws before deleting anything when the account owns videos or playlists.
 */
export async function deleteTestAccount(
	cf: Cf,
	who: { email?: string; userId?: string },
	opts: { dryRun?: boolean; log?: (line: string) => void; now?: number } = {},
): Promise<DeleteReport> {
	const log = opts.log ?? ((l: string) => process.stdout.write(`${l}\n`));
	const now = opts.now ?? Date.now();
	let { email, userId } = who;
	if (email) assertTestAddress(email);
	if (userId) assertUserId(userId);
	if (!email && !userId) throw new Error('deleteTestAccount needs an email or a user id');

	if (email && !userId) {
		const rows = (await d1(cf, AUTH_PROD.d1, 'SELECT id FROM users WHERE email = ?', [email])) as { id: string }[];
		if (rows.length > 1) throw new Error(`${email}: ${rows.length} user rows, not deleting`);
		userId = rows[0]?.id;
		if (!userId) {
			// D1 row already gone: the KV user index still names the id
			const idx = await kvGet(cf, `user${KV_SEP}email${KV_SEP}default${KV_SEP}${email}`);
			const m = idx?.match(/usr_[0-9a-f]{32}/);
			userId = m?.[0];
		}
	}
	if (userId) {
		const record = await kvGet(cf, `user${KV_SEP}default${KV_SEP}${userId}`);
		const dbRow = (await d1(cf, AUTH_PROD.d1, 'SELECT email FROM users WHERE id = ?', [userId]))[0] as { email?: string } | undefined;
		const known = dbRow?.email ?? (record ? (JSON.parse(record) as { email?: string }).email : undefined);
		if (known && !isTestAddress(known)) throw new Error(`refusing ${userId}: its address is not a test address`);
		if (known && email && known !== email) throw new Error(`refusing ${userId}: belongs to another address`);
		email ??= known;
		if (!known) {
			// No auth record at all: only proceed when its videos profile says it is a test account
			const profile = await r2GetJson<{ email?: string }>(cf, BUCKETS.profiles, userId);
			if (!isTestAddress(profile?.email)) throw new Error(`refusing ${userId}: no record shows a test address`);
			email = profile?.email;
		}
	}

	// Videos and playlists carry Bunny media: refuse rather than orphan them
	if (userId) {
		// Channels and the user's own profile row (the admin directory indexes every profile, id = user id)
		// are deleted below; anything else carries media
		const owned = (await d1(cf, SEARCH_PROD.d1, "SELECT kind, count(*) AS n FROM content_ownership WHERE owner_id = ? AND kind NOT IN ('channel', 'profile') GROUP BY kind", [userId])) as {
			kind: string;
			n: number;
		}[];
		if (owned.length) throw new Error(`${email ?? userId}: owns ${owned.map((o) => `${o.n} ${o.kind}(s)`).join(', ')}; delete it through DELETE /api/privacy/data as the user`);
	}

	// Auth KV
	const kv = new Set<string>();
	if (email) {
		const subject = await kvGet(cf, `email${KV_SEP}${email}${KV_SEP}subject`);
		for (const k of kvKeys(email, userId)) kv.add(k);
		if (subject) for (const k of await kvList(cf, refreshPrefix(JSON.parse(subject) as string))) kv.add(k);
	} else if (userId) kv.add(`user${KV_SEP}default${KV_SEP}${userId}`);
	if (userId) {
		// Sessions, and refresh tokens whose subject index is already gone, name the user id in their value
		for (const k of [...(await kvList(cf, 'session:')), ...(await kvList(cf, `oauth:refresh${KV_SEP}`))]) {
			if (kv.has(k)) continue;
			const v = await kvGet(cf, k);
			if (v && kvValueUserId(v) === userId) kv.add(k);
		}
	}
	const existing = [...kv].length ? new Set(await kvList(cf, '')) : new Set<string>();
	const kvTargets = [...kv].filter((k) => existing.has(k));

	// api-videos R2 + search
	const r2: { bucket: string; key: string }[] = [];
	const channelIds: string[] = [];
	if (userId) {
		r2.push({ bucket: BUCKETS.profiles, key: userId });
		for (const key of await r2List(cf, BUCKETS.watchHistory, `${userId}:`)) r2.push({ bucket: BUCKETS.watchHistory, key });
		const owned = (await d1(cf, SEARCH_PROD.d1, "SELECT id FROM content_ownership WHERE kind = 'channel' AND owner_id = ?", [userId])) as { id: string }[];
		const sections = owned.length ? await r2List(cf, BUCKETS.channelSections) : [];
		for (const { id } of owned) {
			const ch = await r2GetJson<{ id: string; userId?: string; handle?: string }>(cf, BUCKETS.channels, id);
			if (ch && ch.userId !== userId) throw new Error(`channel ${id}: stored owner ${ch.userId} is not ${userId}`);
			const handleKey = ch?.handle ? `channel-handles/${ch.handle.toLowerCase()}` : undefined;
			const handle = handleKey ? await r2GetJson<{ channelId?: string }>(cf, BUCKETS.channelTabs, handleKey) : null;
			r2.push(...channelKeys({ id, handle: handle?.channelId === id ? ch?.handle : undefined }, sections));
			channelIds.push(id);
		}
	}

	log(`${email ?? userId}: user ${userId ?? 'none'}, ${kvTargets.length} KV key(s), ${r2.length} R2 object(s), ${channelIds.length} channel(s)${opts.dryRun ? ' (dry run)' : ''}`);
	if (opts.dryRun) return { email, userId, kv: kvTargets.length, r2: r2.length, channels: channelIds.length, authRows: false };

	for (const { bucket, key } of r2) await r2Delete(cf, bucket, key);
	for (const id of channelIds) for (const s of searchChannelDeleteStatements(id, now)) await d1(cf, SEARCH_PROD.d1, s.sql, s.params);
	if (userId) for (const s of searchProfileDeleteStatements(userId, now)) await d1(cf, SEARCH_PROD.d1, s.sql, s.params);
	if (userId) for (const s of authDeleteStatements(userId)) await d1(cf, AUTH_PROD.d1, s.sql, s.params);
	for (const k of kvTargets) await kvDelete(cf, k);
	if (email) {
		const left = (await d1(cf, AUTH_PROD.d1, 'SELECT count(*) AS n FROM users WHERE email = ?', [email]))[0].n;
		if (left !== 0) throw new Error(`${email}: still ${left} user row(s) after delete`);
	}
	log(`${email ?? userId}: deleted`);
	return { email, userId, kv: kvTargets.length, r2: r2.length, channels: channelIds.length, authRows: Boolean(userId) };
}

// ---------------------------------------------------------------------------
// Scan production for leftovers

export interface Leftover {
	store: string;
	key: string;
	email?: string;
	userId?: string;
}

/** A test account found on production; createdAt (ms) when a record says. */
export interface TestAccount {
	email?: string;
	userId?: string;
	createdAt?: number;
}

/** Accounts younger than this may belong to a prod check that is still running. */
export const DEFAULT_MIN_AGE_MS = 60 * 60 * 1000;

/** True when the account is old enough to be a leftover (unknown age counts as old). */
export function isSettled(a: TestAccount, now: number, minAgeMs: number): boolean {
	return a.createdAt === undefined || now - a.createdAt >= minAgeMs;
}

/** Test user ids and addresses named anywhere in auth D1 or KV. */
export async function findTestAccounts(cf: Cf): Promise<TestAccount[]> {
	const found = new Map<string, TestAccount>();
	const add = (a: TestAccount) => {
		const key = a.userId ?? a.email;
		if (!key) return;
		const prev = found.get(key) ?? {};
		found.set(key, { email: a.email ?? prev.email, userId: a.userId ?? prev.userId, createdAt: a.createdAt ?? prev.createdAt });
		if (a.userId && a.email) found.delete(a.email);
	};
	for (const r of (await d1(cf, AUTH_PROD.d1, "SELECT id, email, created_at FROM users WHERE email LIKE '%@delivered.resend.dev' OR email LIKE '%@e2e.alummahnow.net'")) as {
		id: string;
		email: string;
		created_at: number;
	}[])
		if (isTestAddress(r.email)) add({ email: r.email, userId: r.id, createdAt: Number(r.created_at) || undefined });
	const keys = await kvList(cf, '');
	for (const k of keys.filter((k) => k.startsWith('user::default::') || k.startsWith('session:'))) {
		const v = await kvGet(cf, k);
		if (!v) continue;
		const rec = JSON.parse(v) as { id?: string; email?: string; created_at?: number; user?: { id?: string; email?: string } };
		const email = rec.user?.email ?? rec.email;
		const userId = rec.user?.id ?? rec.id;
		if (isTestAddress(email) && userId && USER_ID.test(userId)) add({ email, userId, createdAt: rec.created_at });
	}
	const known = new Set([...found.values()].map((f) => f.email));
	for (const k of keys) {
		const m = k.match(/^(?:email::(.+)::(?:password|subject)|user::email::default::(.+))$/);
		const email = m?.[1] ?? m?.[2];
		if (isTestAddress(email) && !known.has(email)) {
			known.add(email);
			add({ email });
		}
	}
	return [...found.values()];
}

/**
 * Everything a test account left on production, store by store. Accounts created
 * less than minAgeMs ago are skipped: a prod check may still be using them.
 */
export async function scanLeftovers(cf: Cf, opts: { minAgeMs?: number; now?: number } = {}): Promise<Leftover[]> {
	const now = opts.now ?? Date.now();
	const minAgeMs = opts.minAgeMs ?? DEFAULT_MIN_AGE_MS;
	const out: Leftover[] = [];
	const all = await findTestAccounts(cf);
	const accounts = all.filter((a) => isSettled(a, now, minAgeMs));
	const fresh = new Set(all.filter((a) => !isSettled(a, now, minAgeMs)).map((a) => a.userId).filter(Boolean) as string[]);
	const ids = new Set(accounts.map((a) => a.userId).filter(Boolean) as string[]);
	for (const a of accounts) out.push({ store: 'auth', key: a.userId ?? a.email ?? '', email: a.email, userId: a.userId });

	for (const key of await r2List(cf, BUCKETS.profiles)) {
		if (fresh.has(key)) continue;
		if (ids.has(key)) {
			out.push({ store: 'r2:profiles', key, userId: key });
			continue;
		}
		const p = await r2GetJson<{ email?: string }>(cf, BUCKETS.profiles, key);
		if (isTestAddress(p?.email)) out.push({ store: 'r2:profiles', key, email: p?.email, userId: key });
	}
	for (const key of await r2List(cf, BUCKETS.channels)) {
		const c = await r2GetJson<{ userId?: string; email?: string }>(cf, BUCKETS.channels, key);
		if (c?.userId && fresh.has(c.userId)) continue;
		if ((c?.userId && ids.has(c.userId)) || isTestAddress(c?.email)) out.push({ store: 'r2:channels', key, email: c?.email, userId: c?.userId });
	}
	for (const key of await r2List(cf, BUCKETS.watchHistory)) {
		const userId = key.split(':')[0];
		if (ids.has(userId)) out.push({ store: 'r2:watch-history', key, userId });
	}
	for (const r of (await d1(cf, SEARCH_PROD.d1, 'SELECT kind, id, owner_id FROM content_ownership WHERE owner_id LIKE ?', ['usr_%'])) as {
		kind: string;
		id: string;
		owner_id: string;
	}[])
		if (ids.has(r.owner_id)) out.push({ store: `search:${r.kind}`, key: r.id, userId: r.owner_id });
	return out;
}
