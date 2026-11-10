/**
 * Check script for the channel subscription move to D1 (SCALABILITY-AUDIT AV-4).
 *
 * api-videos copies each channel's legacy `subscriptions[]` (channel JSON in
 * the channels bucket) into NOTIFICATIONS_DB.channel_subscriptions once, with
 * a marker row in channel_subscription_imports: on the channel's first
 * subscribe/unsubscribe, and from an hourly cron that walks the bucket. This
 * reports how far that got and fails when something is stuck:
 *
 *   - a channel without a marker that has not changed for STUCK_AFTER_MS
 *     (the cron should have reached it: it is not running or keeps failing);
 *   - a count row that disagrees with the rows of its channel (must never happen).
 *
 *   node --experimental-strip-types scripts/release/check-subscription-import.ts --env qa|stage|production
 *
 * Read-only. Needs CLOUDFLARE_API_TOKEN (R2 read + D1 read) or `wrangler login`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCfClient, d1Query, type CfClient } from './cf-api.ts';
import { parseJsonc } from './jsonc.ts';

/** The cron runs hourly and resumes where it stopped: two days without reaching a channel means stuck. */
export const STUCK_AFTER_MS = 48 * 60 * 60 * 1000;

export interface ChannelObject {
	key: string;
	lastModified: string;
}

export interface SubscriptionImportReport {
	channels: number;
	imported: number;
	/** Not imported, unchanged for long enough that the cron should have taken them */
	stuck: string[];
	/** Not imported yet, changed recently (new channels wait for the next pass) */
	pending: number;
	/** Channels whose count row differs from COUNT(*) of their rows */
	mismatched: string[];
	ok: boolean;
}

/** Pure: judges the channels in R2 against the import markers and count checks from D1. */
export function evaluateSubscriptionImport(
	objects: ChannelObject[],
	importedKeys: Set<string>,
	mismatched: string[],
	now: number,
): SubscriptionImportReport {
	const report: SubscriptionImportReport = { channels: objects.length, imported: 0, stuck: [], pending: 0, mismatched, ok: true };
	for (const object of objects) {
		if (importedKeys.has(object.key)) {
			report.imported++;
			continue;
		}
		const age = now - new Date(object.lastModified).getTime();
		if (age < STUCK_AFTER_MS) report.pending++;
		else report.stuck.push(object.key);
	}
	report.ok = report.stuck.length === 0 && mismatched.length === 0;
	return report;
}

type Env = 'qa' | 'stage' | 'production';

/** Channels bucket and notifications D1 id of an environment, from api-videos' wrangler configs. */
export function targets(root: string, env: Env): { bucket: string; databaseId: string } {
	const dir = join(root, 'apps', 'api-videos');
	const prod = parseJsonc(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')) as any;
	const cfg = env === 'qa' ? (parseJsonc(readFileSync(join(dir, 'wrangler.qa.jsonc'), 'utf8')) as any) : env === 'stage' ? prod.env.stage : prod;
	const bucket = cfg.r2_buckets.find((b: any) => b.binding === 'channels')?.bucket_name;
	const databaseId = cfg.d1_databases.find((d: any) => d.binding === 'NOTIFICATIONS_DB')?.database_id;
	if (!bucket || !databaseId) throw new Error(`api-videos config for ${env} has no channels bucket or NOTIFICATIONS_DB`);
	return { bucket, databaseId };
}

async function listChannels(cf: CfClient, token: string, bucket: string): Promise<ChannelObject[]> {
	const out: ChannelObject[] = [];
	let cursor = '';
	do {
		const qs = new URLSearchParams({ per_page: '1000', ...(cursor ? { cursor } : {}) });
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
	if (!['qa', 'stage', 'production'].includes(envArg)) throw new Error('usage: check-subscription-import.ts --env qa|stage|production');
	const root = join(import.meta.dirname, '..', '..');
	const { bucket, databaseId } = targets(root, envArg);
	const cf = createCfClient();
	const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
	const objects = await listChannels(cf, token, bucket);
	const imported = new Set<string>();
	for (let i = 0; i < objects.length; i += 50) {
		const keys = objects.slice(i, i + 50).map((o) => o.key);
		const rows = await d1Query<{ channel_id: string }>(cf, databaseId, `SELECT channel_id FROM channel_subscription_imports WHERE channel_id IN (${keys.map(() => '?').join(', ')})`, keys);
		for (const row of rows) imported.add(row.channel_id);
	}
	const mismatched = await d1Query<{ channel_id: string }>(
		cf,
		databaseId,
		`SELECT n.channel_id FROM channel_subscriber_counts n
		 WHERE n.subscribers != (SELECT COUNT(*) FROM channel_subscriptions s WHERE s.channel_id = n.channel_id) LIMIT 50`,
	);
	const [state] = await d1Query<{ passes: number; completed_at: number | null; cursor: string | null }>(
		cf,
		databaseId,
		'SELECT passes, completed_at, cursor FROM channel_subscription_import_state WHERE id = 1',
	);
	const report = evaluateSubscriptionImport(objects, imported, mismatched.map((r) => r.channel_id), Date.now());
	console.log(JSON.stringify({ env: envArg, bucket, cron: state ?? null, ...report, stuck: report.stuck.slice(0, 20) }, null, 2));
	if (!report.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(String(error instanceof Error ? error.message : error));
		process.exit(2);
	});
}
