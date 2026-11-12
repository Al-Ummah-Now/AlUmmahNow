/**
 * One-off repair (2026-11-12 incident): stored Bunny URLs that carry a token.
 *
 * Studio's thumbnail picker saved frame URLs with the playUrl's directory token
 * (https://<host>/bcdn_token=…&expires=…&token_path=…/<id>/thumbnail_N.jpg), and
 * the copies spread to the search index and watch history. Tokens expire, so
 * those thumbnails turned into 403s. Responses now sign the unsigned form again
 * (apps/api-videos/src/lib/bunny-signing.ts), and this script rewrites every
 * stored copy to the unsigned form:
 *
 *   - R2 JSON records of api-videos (videos, playlists, watch history,
 *     channel sections, community posts, scheduled videos, channels);
 *   - the search D1 `payload` rows (search_videos, search_playlists,
 *     search_channels, search_posts).
 *
 * Only string values that carry a Bunny token change (unsignedBunnyUrl); nothing
 * else in a record is touched. The default is a dry run that prints counts.
 *
 * Usage (repo root):
 *   node --experimental-strip-types --no-warnings scripts/release/repair-signed-bunny-urls.ts --env qa|stage|production [--apply] [--only videos,channels,search]
 * Production also needs --allow-production with --apply.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cfToken, DEFAULT_ACCOUNT_ID } from './cf-api.ts';
import { unsignedBunnyUrl } from '../../apps/api-videos/src/lib/bunny-signing.ts';

export type RepairEnv = 'qa' | 'stage' | 'production';

const BUCKETS = ['videos', 'playlists', 'watch-history', 'channel-sections', 'community-posts', 'scheduled-videos', 'channels'];
const SEARCH_DB: Record<RepairEnv, string> = {
	production: '41064871-cf1f-46e9-b102-7b913240ad89',
	stage: '956a3550-bd20-4cfc-9bf2-b1c2265b33dd',
	qa: '0282bac3-5b70-4343-a991-937c732d981a',
};
const SEARCH_TABLES = ['search_videos', 'search_playlists', 'search_channels', 'search_posts'];

export function bucketName(base: string, env: RepairEnv): string {
	return env === 'production' ? base : `${base}-${env}`;
}

/** Cheap pre-filter before parsing: the text holds a token of either form */
export function mayHoldToken(text: string): boolean {
	return text.includes('bcdn_token=') || /[?&]token=[^&"\s]*&expires=\d/.test(text);
}

/** Rewrite every string value that is a signed Bunny URL; returns the number changed */
export function unsignDeep(node: unknown, onChange?: (before: string, after: string) => void): { value: unknown; changed: number } {
	let changed = 0;
	const walk = (v: unknown): unknown => {
		if (typeof v === 'string') {
			if (!v.startsWith('https://')) return v;
			const after = unsignedBunnyUrl(v);
			if (after !== v) {
				changed++;
				onChange?.(v, after);
			}
			return after;
		}
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === 'object') {
			const out: Record<string, unknown> = {};
			for (const [k, val] of Object.entries(v)) out[k] = walk(val);
			return out;
		}
		return v;
	};
	const value = walk(node);
	return { value, changed };
}

/** Repaired JSON text, or null when nothing needs changing */
export function repairText(text: string): { text: string; urls: number } | null {
	if (!mayHoldToken(text)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	const { value, changed } = unsignDeep(parsed);
	return changed ? { text: JSON.stringify(value), urls: changed } : null;
}

/** Bearer token, re-read after a refresh: a `wrangler login` OAuth token lasts about an hour */
let bearer = '';
function refreshToken(): void {
	// Any authenticated wrangler command refreshes the OAuth token on disk
	if (!process.env.CLOUDFLARE_API_TOKEN) execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore' });
	bearer = cfToken() ?? '';
}

async function fetchRetry(url: string, init: RequestInit, attempts = 10): Promise<Response> {
	let refreshed = false;
	for (let i = 1; ; i++) {
		const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${bearer}` } });
		if (res.status === 401 && !refreshed) {
			refreshed = true;
			refreshToken();
			i--;
			continue;
		}
		if (i >= attempts || (res.status !== 429 && res.status < 500)) return res;
		await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** i, 30000)));
	}
}

async function main(argv: string[]): Promise<void> {
	const env = argv[argv.indexOf('--env') + 1] as RepairEnv;
	if (!['qa', 'stage', 'production'].includes(env)) throw new Error('usage: --env qa|stage|production [--apply] [--allow-production]');
	const apply = argv.includes('--apply');
	if (apply && env === 'production' && !argv.includes('--allow-production')) throw new Error('production --apply needs --allow-production');
	bearer = cfToken() ?? '';
	if (!bearer) throw new Error('No Cloudflare credentials');
	// --only videos,channels,search: resume part of a run (bucket base names; "search" = the D1 rows)
	const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
	const account = process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
	const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
	const headers: Record<string, string> = {};
	console.log(`${apply ? 'APPLY' : 'DRY RUN'} on ${env}`);

	let totalRecords = 0;
	let totalUrls = 0;
	let totalUnread = 0;
	for (const base of BUCKETS) {
		if (only && !only.has(base)) continue;
		const bucket = bucketName(base, env);
		const objectUrl = (key: string) => `${api}/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
		const keys: string[] = [];
		let cursor: string | undefined;
		do {
			const qs = new URLSearchParams({ per_page: '1000', ...(cursor ? { cursor } : {}) });
			const res = await fetchRetry(`${api}/r2/buckets/${bucket}/objects?${qs}`, { headers });
			const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { key: string }[]; result_info?: { cursor?: string; is_truncated?: boolean | string } };
			if (res.status === 404) break;
			if (!res.ok || !json.success) throw new Error(`listing ${bucket} -> HTTP ${res.status}`);
			for (const o of json.result ?? []) keys.push(o.key);
			const truncated = json.result_info?.is_truncated === true || json.result_info?.is_truncated === 'true';
			cursor = truncated ? json.result_info?.cursor : undefined;
		} while (cursor);

		let records = 0;
		let urls = 0;
		let unread = 0;
		const queue = [...keys];
		const worker = async () => {
			for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
				const res = await fetchRetry(objectUrl(key), { headers });
				if (!res.ok) {
					if (res.status !== 404) {
						unread++;
						console.warn(`  GET ${bucket}/${key} -> HTTP ${res.status}`);
					}
					continue;
				}
				const repaired = repairText(await res.text());
				if (!repaired) continue;
				records++;
				urls += repaired.urls;
				console.log(`  ${bucket}/${key}: ${repaired.urls} URL(s)`);
				if (apply) {
					const put = await fetchRetry(objectUrl(key), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: repaired.text });
					if (!put.ok) throw new Error(`PUT ${bucket}/${key} -> HTTP ${put.status}`);
				}
			}
		};
		await Promise.all(Array.from({ length: 4 }, worker));
		console.log(`${bucket}: ${keys.length} objects scanned, ${records} with signed URLs (${urls} URLs)${unread ? `, ${unread} UNREAD (run again)` : ''}`);
		totalUnread += unread;
		totalRecords += records;
		totalUrls += urls;
	}

	const d1 = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
		const res = await fetchRetry(`${api}/d1/database/${SEARCH_DB[env]}/query`, {
			method: 'POST',
			headers: { ...headers, 'Content-Type': 'application/json' },
			body: JSON.stringify({ sql, params }),
		});
		const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { results: T[] }[] };
		if (!res.ok || !json.success) throw new Error(`D1 query -> HTTP ${res.status}`);
		return json.result?.[0]?.results ?? [];
	};
	for (const table of only && !only.has('search') ? [] : SEARCH_TABLES) {
		const rows = await d1<{ id: string; payload: string }>(`SELECT id, payload FROM ${table} WHERE payload LIKE '%token=%'`);
		let fixed = 0;
		let urls = 0;
		for (const row of rows) {
			const repaired = repairText(row.payload);
			if (!repaired) continue;
			fixed++;
			urls += repaired.urls;
			console.log(`  ${table}/${row.id}: ${repaired.urls} URL(s)`);
			if (apply) await d1(`UPDATE ${table} SET payload = ? WHERE id = ? AND payload = ?`, [repaired.text, row.id, row.payload]);
		}
		console.log(`${table}: ${fixed} rows with signed URLs (${urls} URLs)`);
		totalRecords += fixed;
		totalUrls += urls;
	}
	console.log(`${apply ? 'Repaired' : 'Would repair'} ${totalRecords} records/rows, ${totalUrls} URLs on ${env}${totalUnread ? `; ${totalUnread} objects unread` : ''}`);
	if (totalUnread) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
