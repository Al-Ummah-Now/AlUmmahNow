/**
 * Check script for community post likes and poll votes in D1 (SCALABILITY-AUDIT PR-2/3/4).
 *
 * The processor moves each post's legacy likes / votes from R2 into D1 the
 * first time the post gets an event (and an hourly sweep finishes stalled
 * moves); readers use the D1 totals once a post is done. This reports:
 *
 *   - imports not done and untouched for STUCK_AFTER_MS (the move is stuck);
 *   - for up to --sample done posts, D1 totals against the R2 records, which
 *     are the truth (a mismatch means a lost or doubled count).
 *
 *   node --experimental-strip-types scripts/release/check-post-counters.ts --env qa|stage|production [--sample 50]
 *
 * Read-only. Needs CLOUDFLARE_API_TOKEN (R2 read + D1 read) or `wrangler login`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCfClient, d1Query, type CfClient } from './cf-api.ts';
import { parseJsonc } from './jsonc.ts';

/** Every event and the hourly sweep move a stalled import on: two hours untouched means stuck. */
export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

export interface ImportRow {
	post_id: string;
	kind: 'likes' | 'votes';
	done: number;
	updated_at: string;
}

export interface Sample {
	postId: string;
	kind: 'likes' | 'votes';
	/** Total in D1 */
	counted: number;
	/** Records in R2 */
	records: number;
}

export interface PostCounterReport {
	imports: number;
	done: number;
	stuck: string[];
	mismatched: Sample[];
	checked: number;
	ok: boolean;
}

/** Pure: judges the import markers and the sampled totals. */
export function evaluatePostCounters(rows: ImportRow[], samples: Sample[], now: number): PostCounterReport {
	const stuck = rows
		.filter((r) => !r.done && now - new Date(r.updated_at).getTime() >= STUCK_AFTER_MS)
		.map((r) => `${r.kind}:${r.post_id}`);
	const mismatched = samples.filter((s) => s.counted !== s.records);
	return {
		imports: rows.length,
		done: rows.filter((r) => r.done).length,
		stuck,
		mismatched,
		checked: samples.length,
		ok: stuck.length === 0 && mismatched.length === 0,
	};
}

type Env = 'qa' | 'stage' | 'production';

/** Community posts bucket and notifications D1 id of an environment, from the processor's wrangler configs. */
export function targets(root: string, env: Env): { bucket: string; databaseId: string } {
	const dir = join(root, 'apps', 'processor');
	const prod = parseJsonc(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')) as any;
	const cfg = env === 'qa' ? (parseJsonc(readFileSync(join(dir, 'wrangler.qa.jsonc'), 'utf8')) as any) : env === 'stage' ? prod.env.stage : prod;
	const bucket = cfg.r2_buckets.find((b: any) => b.binding === 'community_posts')?.bucket_name;
	const databaseId = cfg.d1_databases.find((d: any) => d.binding === 'NOTIFICATIONS_DB')?.database_id;
	if (!bucket || !databaseId) throw new Error(`processor config for ${env} has no community_posts or NOTIFICATIONS_DB`);
	return { bucket, databaseId };
}

/** Number of user records under likes/<postId>/ or votes/<postId>/ (results.json is not a voter). */
async function countRecords(cf: CfClient, token: string, bucket: string, prefix: string): Promise<number> {
	let n = 0;
	let cursor = '';
	do {
		const qs = new URLSearchParams({ prefix, per_page: '1000', ...(cursor ? { cursor } : {}) });
		const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/r2/buckets/${bucket}/objects?${qs}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const json = (await res.json()) as { success: boolean; result?: { key: string }[]; result_info?: { cursor?: string; is_truncated?: boolean } };
		if (!res.ok || !json.success) throw new Error(`listing ${bucket} failed: HTTP ${res.status}`);
		n += (json.result ?? []).filter((o) => !o.key.endsWith('/results.json')).length;
		cursor = json.result_info?.is_truncated ? json.result_info.cursor ?? '' : '';
	} while (cursor);
	return n;
}

async function main() {
	const envArg = process.argv[process.argv.indexOf('--env') + 1] as Env;
	if (!['qa', 'stage', 'production'].includes(envArg)) throw new Error('usage: check-post-counters.ts --env qa|stage|production [--sample N]');
	const sampleArg = process.argv.indexOf('--sample');
	const sampleSize = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : 50;
	const root = join(import.meta.dirname, '..', '..');
	const { bucket, databaseId } = targets(root, envArg);
	const cf = createCfClient();
	const token = process.env.CLOUDFLARE_API_TOKEN ?? '';

	const rows = await d1Query<ImportRow>(cf, databaseId, 'SELECT post_id, kind, done, updated_at FROM post_counter_imports');
	const samples: Sample[] = [];
	for (const row of rows.filter((r) => r.done).slice(0, sampleSize)) {
		const metric = row.kind === 'likes' ? 'likes' : 'poll_votes';
		const [sum] = await d1Query<{ total: number }>(
			cf,
			databaseId,
			`SELECT COALESCE(SUM(value), 0) AS total FROM analytics_daily WHERE entity_type = 'post' AND entity_id = ? AND metric = ?`,
			[row.post_id, metric],
		);
		samples.push({ postId: row.post_id, kind: row.kind, counted: Number(sum?.total ?? 0), records: await countRecords(cf, token, bucket, `${row.kind}/${row.post_id}/`) });
	}
	const report = evaluatePostCounters(rows, samples, Date.now());
	console.log(JSON.stringify({ env: envArg, bucket, ...report, stuck: report.stuck.slice(0, 20), mismatched: report.mismatched.slice(0, 20) }, null, 2));
	if (!report.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(String(error instanceof Error ? error.message : error));
		process.exit(2);
	});
}
