/**
 * One-time bounded backfill for pre-existing `legacy-restore/` profile copies
 * in ADMIN_BACKUPS (./legacy-restore-pointers.ts).
 *
 * IMPORTANT:
 * - Run ONLY after the pointer-index change (api-videos lib/admin/legacy-restore.ts)
 *   is deployed to the target environment.
 * - Scoped to one environment per run (`--env qa|stage|production`).
 * - Dry run by default (reads only, writes/deletes nothing). Pass `--apply` only
 *   after reviewing and approving the dry-run counts for that environment.
 * - Bounded by `--max-pages` (default 10, hard cap 50) and resumable with `--cursor`.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa --max-pages 10 --cursor <cursor>
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-legacy-restore-pointers.ts --env qa --apply
 *
 * Needs CLOUDFLARE_API_TOKEN (or `wrangler login`) with R2 access.
 */
import { cfToken, DEFAULT_ACCOUNT_ID } from '../release/cf-api.ts';
import {
	ENVIRONMENTS,
	HARD_MAX_PAGES,
	backfillLegacyRestorePointers,
	parseCliArgs,
	type BackfillStore,
} from './legacy-restore-pointers.ts';

let cli;
try {
	cli = parseCliArgs(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(`Usage: backfill-legacy-restore-pointers.ts --env qa|stage|production [--apply] [--cursor <cursor>] [--max-pages 1..${HARD_MAX_PAGES}] [--per-page 1..1000]`);
	process.exit(2);
}

const token = cfToken();
if (!token) throw new Error('No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `wrangler login`');

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
const { backupsBucket, profilesBucket } = ENVIRONMENTS[cli.env];
const bucketUrl = (bucket: string) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`;
const authHeader = { Authorization: `Bearer ${token}` };

/** Rate-limit aware Cloudflare API fetch (matches scripts/data/backfill-legacy-profiles.ts). */
async function cfFetch(url: string, init: RequestInit = {}): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { ...init, headers: { ...authHeader, ...(init.headers as Record<string, string> | undefined) } });
		if ((res.status !== 429 && res.status < 500) || attempt >= 8) return res;
		const wait = Number(res.headers.get('retry-after')) * 1000 || Math.min(60_000, 2000 * 2 ** attempt);
		await new Promise((r) => setTimeout(r, wait));
	}
}

async function headObject(bucket: string, key: string): Promise<boolean> {
	const res = await cfFetch(`${bucketUrl(bucket)}/${encodeURIComponent(key)}`, { method: 'HEAD' });
	if (res.status === 404) return false;
	if (!res.ok) throw new Error(`HEAD ${bucket}/${key}: HTTP ${res.status}`);
	return true;
}

const store: BackfillStore = {
	async listBackups({ prefix, perPage, cursor }) {
		const params = new URLSearchParams({ prefix, per_page: String(perPage) });
		if (cursor) params.set('cursor', cursor);
		const res = await cfFetch(`${bucketUrl(backupsBucket)}?${params.toString()}`);
		const json = (await res.json()) as {
			success: boolean;
			result?: { key: string }[];
			result_info?: { cursor?: string; is_truncated?: boolean };
		};
		if (!res.ok || !json.success || !Array.isArray(json.result)) {
			throw new Error(`LIST ${backupsBucket} (${prefix}): HTTP ${res.status}`);
		}
		return {
			keys: json.result.map((o) => o.key),
			truncated: Boolean(json.result_info?.is_truncated),
			cursor: json.result_info?.cursor,
		};
	},
	headProfile: (profileId) => headObject(profilesBucket, profileId),
	headBackup: (key) => headObject(backupsBucket, key),
	async putPointer(pointerKey) {
		const res = await cfFetch(`${bucketUrl(backupsBucket)}/${encodeURIComponent(pointerKey)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: '',
		});
		if (!res.ok) throw new Error(`PUT ${backupsBucket}/${pointerKey}: HTTP ${res.status}`);
	},
	async deleteBackup(backupKey) {
		const res = await cfFetch(`${bucketUrl(backupsBucket)}/${encodeURIComponent(backupKey)}`, { method: 'DELETE' });
		if (!res.ok && res.status !== 404) throw new Error(`DELETE ${backupsBucket}/${backupKey}: HTTP ${res.status}`);
	},
};

const report = await backfillLegacyRestorePointers(store, {
	dryRun: !cli.apply,
	cursor: cli.cursor,
	maxPages: cli.maxPages,
	perPage: cli.perPage,
});

console.log(JSON.stringify({ env: cli.env, backupsBucket, profilesBucket, ...report }, null, 2));
if (report.dryRun) {
	console.log('\nDry run: nothing written or deleted. Run only after #1902 is deployed and counts are approved, with --apply.');
}
if (!report.complete && report.nextCursor) {
	console.log(`\nPage cap reached (${report.pagesProcessed} pages). Resume with:\n  --env ${cli.env}${cli.apply ? ' --apply' : ''} --cursor ${report.nextCursor}`);
}
