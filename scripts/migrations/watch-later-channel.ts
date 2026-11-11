/**
 * Clears `channelId` on every stored Watch later list (`watch-later-<userId>`
 * in the playlists bucket).
 *
 * Watch later belongs to the user. Lists made before the fix carried the
 * channel that was active at the first save, so the owner saw "Watch later"
 * among that channel's playlists. The API now skips system playlists in every
 * channel listing and clears the channel on any Watch later write; this clears
 * the lists nobody has touched since.
 *
 *   npx tsx scripts/migrations/watch-later-channel.ts --env qa|stage|production [--apply] [--backup-dir <dir>]
 *
 * Dry run unless --apply. Idempotent: a list without a channel is skipped, so
 * a re-run changes nothing. With --apply each list is backed up (as read) to
 * <backup-dir>/<key>.json, re-read just before the write, and written only
 * with `channelId` cleared (every other field as stored).
 *
 * Credentials: CLOUDFLARE_API_TOKEN (R2 edit) or the `wrangler login` token.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cfToken, DEFAULT_ACCOUNT_ID } from '../release/cf-api.ts';
import { WATCH_LATER_PREFIX, clearedWatchLater } from './watch-later.ts';

const BUCKETS: Record<string, string> = { qa: 'playlists-qa', stage: 'playlists-stage', production: 'playlists' };

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const envName = arg('env') ?? '';
const bucket = BUCKETS[envName];
if (!bucket) {
	console.error('Usage: --env qa|stage|production [--apply] [--backup-dir <dir>]');
	process.exit(2);
}
const apply = process.argv.includes('--apply');
const backupDir = resolve(arg('backup-dir') ?? `watch-later-backup-${envName}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
let token = cfToken();
if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID}/r2/buckets/${bucket}`;

async function call(method: string, path: string, init: { body?: string; json?: boolean } = {}): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) }, body: init.body });
		if (res.status === 401 && attempt < 2 && !process.env.CLOUDFLARE_API_TOKEN) {
			// The `wrangler login` token lasts about an hour; any wrangler command refreshes it
			execSync('npx -y wrangler whoami', { stdio: 'ignore' });
			token = cfToken() ?? token;
			continue;
		}
		if ((res.status === 429 || res.status >= 500) && attempt < 6) {
			await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
			continue;
		}
		return res;
	}
}

async function listKeys(): Promise<string[]> {
	const keys: string[] = [];
	let cursor = '';
	do {
		const qs = new URLSearchParams({ prefix: WATCH_LATER_PREFIX, per_page: '1000', ...(cursor ? { cursor } : {}) });
		const res = await call('GET', `/objects?${qs}`);
		const body = (await res.json()) as { result?: { key: string }[]; result_info?: { cursor?: string; is_truncated?: boolean } };
		if (!res.ok) throw new Error(`list ${bucket} -> ${res.status}`);
		keys.push(...(body.result ?? []).map((o) => o.key));
		cursor = body.result_info?.is_truncated ? body.result_info.cursor ?? '' : '';
	} while (cursor);
	return keys;
}

async function read(key: string): Promise<string | null> {
	const res = await call('GET', `/objects/${encodeURIComponent(key)}`);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`GET ${bucket}/${key} -> ${res.status}`);
	return res.text();
}

async function main() {
	const keys = await listKeys();
	console.log(`${envName}: ${keys.length} Watch later lists in ${bucket}${apply ? '' : ' (dry run)'}`);
	let changed = 0;
	let clean = 0;
	let failed = 0;
	for (const key of keys) {
		try {
			const text = await read(key);
			const next = text === null ? null : clearedWatchLater(text);
			if (!next) {
				clean++;
				continue;
			}
			const before = JSON.parse(text!).channelId;
			console.log(`  ${key}: channelId ${JSON.stringify(before)} -> ""`);
			if (!apply) {
				changed++;
				continue;
			}
			mkdirSync(backupDir, { recursive: true });
			writeFileSync(join(backupDir, `${key}.json`), text!);
			// Re-read just before the write so a save made meanwhile is kept
			const fresh = await read(key);
			const freshNext = fresh === null ? null : clearedWatchLater(fresh);
			if (!freshNext) {
				clean++;
				continue;
			}
			const put = await call('PUT', `/objects/${encodeURIComponent(key)}`, { body: freshNext, json: true });
			if (!put.ok) throw new Error(`PUT -> ${put.status}`);
			changed++;
		} catch (error) {
			failed++;
			console.error(`  ${key}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	console.log(`${apply ? 'cleared' : 'would clear'}: ${changed}, already clean: ${clean}, failed: ${failed}${apply && changed ? `, backups: ${backupDir}` : ''}`);
	if (failed) process.exit(1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
