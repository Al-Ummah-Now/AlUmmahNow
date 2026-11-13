/**
 * Check script for the analytics rollup move to D1 (SCALABILITY-AUDIT PR-1).
 *
 * The processor imports the legacy monthly documents
 * (analytics/rollups/{video,channel}/<id>/<YYYY-MM>.json in the messages bucket)
 * into the D1 counters hourly, once a document is a day old, and deletes it.
 * This reports how far that got and fails when something is stuck:
 *
 *   - a document older than STUCK_AFTER_MS that is still not imported
 *     (the import cron is not running or keeps failing on it);
 *   - a document that is imported but still in R2 for longer than that
 *     (its delete keeps failing; harmless to the numbers, readers skip it).
 *
 *   node --experimental-strip-types scripts/release/check-rollup-import.ts --env qa|stage|production
 *
 * Read-only. Needs CLOUDFLARE_API_TOKEN (R2 read + D1 read) or `wrangler login`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCfClient, d1Query, type CfClient } from './cf-api.ts';
import { parseJsonc } from './jsonc.ts';

export const ROLLUP_PREFIX = 'analytics/rollups/';
/** Import waits a day after the last write and runs hourly: two days means stuck. */
export const STUCK_AFTER_MS = 48 * 60 * 60 * 1000;

export interface LegacyObject {
	key: string;
	lastModified: string;
}

export interface ImportReport {
	remaining: number;
	/** Not imported and old enough that the import should have taken them */
	stuck: string[];
	/** Imported but not deleted for a long time */
	undeleted: string[];
	/** Waiting for their first day without writes */
	pending: number;
	ok: boolean;
}

/** Pure: judges the legacy documents still in R2 against the import markers in D1. */
export function evaluateImport(objects: LegacyObject[], importedKeys: Set<string>, now: number): ImportReport {
	const report: ImportReport = { remaining: objects.length, stuck: [], undeleted: [], pending: 0, ok: true };
	for (const object of objects) {
		const age = now - new Date(object.lastModified).getTime();
		const old = !(age < STUCK_AFTER_MS);
		if (importedKeys.has(object.key)) {
			if (old) report.undeleted.push(object.key);
		} else if (old) {
			report.stuck.push(object.key);
		} else {
			report.pending++;
		}
	}
	report.ok = report.stuck.length === 0 && report.undeleted.length === 0;
	return report;
}

type Env = 'qa' | 'stage' | 'production';

/** Messages bucket and notifications D1 id of an environment, from the processor's wrangler configs. */
export function targets(root: string, env: Env): { bucket: string; databaseId: string } {
	const dir = join(root, 'apps', 'processor');
	const prod = parseJsonc(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')) as any;
	const cfg = env === 'qa' ? (parseJsonc(readFileSync(join(dir, 'wrangler.qa.jsonc'), 'utf8')) as any) : env === 'stage' ? prod.env.stage : prod;
	const bucket = cfg.r2_buckets.find((b: any) => b.binding === 'MESSAGES_BUCKET')?.bucket_name;
	const databaseId = cfg.d1_databases.find((d: any) => d.binding === 'NOTIFICATIONS_DB')?.database_id;
	if (!bucket || !databaseId) throw new Error(`processor config for ${env} has no MESSAGES_BUCKET or NOTIFICATIONS_DB`);
	return { bucket, databaseId };
}

async function listLegacy(cf: CfClient, token: string, bucket: string): Promise<LegacyObject[]> {
	const out: LegacyObject[] = [];
	let cursor = '';
	do {
		const qs = new URLSearchParams({ prefix: ROLLUP_PREFIX, per_page: '1000', ...(cursor ? { cursor } : {}) });
		const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/r2/buckets/${bucket}/objects?${qs}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const json = (await res.json()) as { success: boolean; result?: { key: string; last_modified: string }[]; result_info?: { cursor?: string; is_truncated?: boolean } };
		if (!res.ok || !json.success) throw new Error(`listing ${bucket} failed: HTTP ${res.status}`);
		for (const o of json.result ?? []) out.push({ key: o.key, lastModified: o.last_modified });
		cursor = json.result_info?.is_truncated ? json.result_info.cursor ?? '' : '';
	} while (cursor);
	return out;
}

async function main() {
	const envArg = process.argv[process.argv.indexOf('--env') + 1] as Env;
	if (!['qa', 'stage', 'production'].includes(envArg)) throw new Error('usage: check-rollup-import.ts --env qa|stage|production');
	const root = join(import.meta.dirname, '..', '..');
	const { bucket, databaseId } = targets(root, envArg);
	const cf = createCfClient();
	const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
	const objects = await listLegacy(cf, token, bucket);
	const imported = new Set<string>();
	for (let i = 0; i < objects.length; i += 50) {
		const keys = objects.slice(i, i + 50).map((o) => o.key);
		const rows = await d1Query<{ r2_key: string }>(cf, databaseId, `SELECT r2_key FROM analytics_rollup_imports WHERE r2_key IN (${keys.map(() => '?').join(', ')})`, keys);
		for (const row of rows) imported.add(row.r2_key);
	}
	const [counts] = await d1Query<{ imports: number; rows: number }>(cf, databaseId, 'SELECT (SELECT COUNT(*) FROM analytics_rollup_imports) AS imports, (SELECT COUNT(*) FROM analytics_daily) AS rows');
	const report = evaluateImport(objects, imported, Date.now());
	console.log(JSON.stringify({ env: envArg, bucket, imported: counts?.imports ?? 0, counterRows: counts?.rows ?? 0, ...report, stuck: report.stuck.slice(0, 20), undeleted: report.undeleted.slice(0, 20) }, null, 2));
	if (!report.ok) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(String(error instanceof Error ? error.message : error));
		process.exit(2);
	});
}
