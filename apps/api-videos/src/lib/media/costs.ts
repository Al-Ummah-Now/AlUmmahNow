/**
 * Daily cost inputs per delivery source (epic #687, Phase 3) → delivery_cost_daily
 * (migrations/search/0020): one row per (day, provider, metric). The admin
 * Delivery comparison page divides them into cost per video-minute and per
 * viewer-hour and projects them against the $500/month cap.
 *
 * Sources:
 *   our own records  container seconds, bytes written, objects (Class A), video
 *                    minutes transcoded (media_jobs); viewer-hours and bitrate
 *                    per source (playback_qoe_daily)
 *   Bunny Stream API the library's stored bytes (sum of storageSize), with the
 *                    library key api-videos already has
 *   Cloudflare GraphQL (optional, MEDIA_ANALYTICS_TOKEN: Account Analytics Read)
 *                    R2 storage and Class B reads for the media buckets, media
 *                    host requests, bytes and cache hits
 * Every part is best effort: a missing input leaves its metric out, never fails the run.
 */
import { getSecret, requireSecret } from '../env-helpers';
import { logger } from '../logger';

/** List prices (2026-11), USD. Kept here so the page and the collector agree. */
export const PRICES = {
	containerInstanceSecond: 4 * 0.00002 + 12 * 0.0000025 + 20 * 0.00000007, // standard-4: vCPU + GiB + GB disk
	r2GbMonth: 0.015,
	r2ClassAPerMillion: 4.5,
	r2ClassBPerMillion: 0.36,
	bunnyStorageGbMonthPerRegion: 0.01,
	bunnyRegions: 2,
	bunnyEgressGb: 0.01,
} as const;

export interface CostEnv {
	SEARCH_DB?: D1Database;
	'bunny-stream-key'?: unknown;
	bunny_stream_library_id?: unknown;
	MEDIA_ANALYTICS_TOKEN?: unknown;
	MEDIA_PUBLIC_HOST?: string;
	/** Bucket names, for the GraphQL filters */
	MEDIA_BUCKET_NAMES?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
}

export type Metric = { provider: 'r2' | 'bunny'; metric: string; value: number };

const GB = 1024 ** 3;
const ACCOUNT_ID = '0e4b6e7f9faf280c3c9bf95995edc64f';
const ZONE_ID = 'fada86a0f215bda23dbe19de7226b49f';

/** Pure: our own day's numbers → metrics with estimated cost (tested). */
export function metricsFromRecords(input: {
	jobs: { containerSeconds: number; bytes: number; objects: number; videoSeconds: number; storedBytes: number };
	qoe: { provider: string; watchMs: number; kbpsWatchS: number }[];
	bunnyStoredBytes?: number;
	r2StoredBytes?: number;
	r2ClassB?: number;
}): Metric[] {
	const out: Metric[] = [];
	const add = (provider: Metric['provider'], metric: string, value: number | undefined) => {
		if (value !== undefined && Number.isFinite(value)) out.push({ provider, metric, value: Math.round(value * 1e6) / 1e6 });
	};
	const viewer = (p: string) => {
		const rows = input.qoe.filter((q) => q.provider === p);
		const watchS = rows.reduce((n, r) => n + r.watchMs, 0) / 1000;
		const kbpsS = rows.reduce((n, r) => n + r.kbpsWatchS, 0);
		return { hours: watchS / 3600, gb: (kbpsS * 1000) / 8 / GB };
	};
	const r2 = viewer('r2');
	const bunny = viewer('bunny');

	const storedR2 = input.r2StoredBytes ?? input.jobs.storedBytes;
	add('r2', 'container_seconds', input.jobs.containerSeconds);
	add('r2', 'video_minutes', input.jobs.videoSeconds / 60);
	add('r2', 'class_a_ops', input.jobs.objects);
	add('r2', 'class_b_ops', input.r2ClassB);
	add('r2', 'stored_gb', storedR2 / GB);
	add('r2', 'viewer_hours', r2.hours);
	add('r2', 'delivered_gb', r2.gb);
	const r2Cost =
		input.jobs.containerSeconds * PRICES.containerInstanceSecond +
		(storedR2 / GB) * (PRICES.r2GbMonth / 30) +
		(input.jobs.objects / 1e6) * PRICES.r2ClassAPerMillion +
		((input.r2ClassB ?? 0) / 1e6) * PRICES.r2ClassBPerMillion;
	add('r2', 'cost_usd', r2Cost);

	add('bunny', 'viewer_hours', bunny.hours);
	add('bunny', 'delivered_gb', bunny.gb);
	// Name the admin page reads for Bunny's billed traffic (estimated from watch time × bitrate)
	add('bunny', 'egress_gb', bunny.gb);
	if (input.bunnyStoredBytes !== undefined) add('bunny', 'stored_gb', input.bunnyStoredBytes / GB);
	const bunnyCost =
		((input.bunnyStoredBytes ?? 0) / GB) * ((PRICES.bunnyStorageGbMonthPerRegion * PRICES.bunnyRegions) / 30) + bunny.gb * PRICES.bunnyEgressGb;
	add('bunny', 'cost_usd', bunnyCost);
	return out;
}

async function bunnyStoredBytes(env: CostEnv): Promise<number | undefined> {
	try {
		const key = await requireSecret(env['bunny-stream-key'] as never, 'bunny-stream-key');
		const lib = await requireSecret(env.bunny_stream_library_id as never, 'bunny_stream_library_id');
		let total = 0;
		for (let page = 1; page <= 100; page++) {
			const res = await fetch(`https://video.bunnycdn.com/library/${encodeURIComponent(lib)}/videos?page=${page}&itemsPerPage=1000`, { headers: { AccessKey: key, accept: 'application/json' } });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as { items?: { storageSize?: number }[]; totalItems?: number };
			for (const v of body.items ?? []) total += v.storageSize ?? 0;
			if (!body.items || body.items.length < 1000) break;
		}
		return total;
	} catch (error) {
		logger.warn('[MediaCosts] Bunny storage unavailable', { error: error instanceof Error ? error.message : String(error) });
		return undefined;
	}
}

async function graphql(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
	const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	});
	const json = (await res.json()) as { data?: any; errors?: { message: string }[] | null };
	if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
	return json.data;
}

const CLASS_B = new Set(['GetObject', 'HeadObject', 'HeadBucket', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration']);

/**
 * Cloudflare GraphQL for the day (only with MEDIA_ANALYTICS_TOKEN). Two reads, each optional:
 * R2 storage and operations (Account Analytics Read) and the media host's requests, bytes and
 * cache status (Zone Analytics Read). A refused one leaves its metrics out, never the other's.
 */
async function cloudflareDay(env: CostEnv, day: string): Promise<{ r2StoredBytes?: number; r2ClassB?: number; extra: Metric[] }> {
	const token = await getSecret(env.MEDIA_ANALYTICS_TOKEN, 'MEDIA_ANALYTICS_TOKEN');
	if (!token) return { extra: [] };
	const buckets = (env.MEDIA_BUCKET_NAMES ?? '').split(',').filter(Boolean);
	const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
	const out: { r2StoredBytes?: number; r2ClassB?: number; extra: Metric[] } = { extra: [] };
	try {
		const data = await graphql(
			token,
			`query($a: String!, $b: [String!], $d: Date!, $n: Date!) { viewer { accounts(filter: { accountTag: $a }) {
				r2StorageAdaptiveGroups(limit: 100, filter: { date_geq: $d, date_lt: $n, bucketName_in: $b }) { max { payloadSize metadataSize } dimensions { bucketName } }
				r2OperationsAdaptiveGroups(limit: 100, filter: { date_geq: $d, date_lt: $n, bucketName_in: $b }) { sum { requests } dimensions { actionType } } } } }`,
			{ a: env.CLOUDFLARE_ACCOUNT_ID || ACCOUNT_ID, b: buckets, d: day, n: next },
		);
		const acct = data?.viewer?.accounts?.[0] ?? {};
		const stored = (acct.r2StorageAdaptiveGroups ?? []).reduce((n: number, g: any) => n + (g.max?.payloadSize ?? 0) + (g.max?.metadataSize ?? 0), 0);
		out.r2StoredBytes = stored || undefined;
		out.r2ClassB = (acct.r2OperationsAdaptiveGroups ?? []).filter((g: any) => CLASS_B.has(g.dimensions?.actionType)).reduce((n: number, g: any) => n + (g.sum?.requests ?? 0), 0);
	} catch (error) {
		logger.warn('[MediaCosts] R2 analytics unavailable', { error: error instanceof Error ? error.message : String(error) });
	}
	try {
		const data = await graphql(
			token,
			`query($z: String!, $d: Date!, $n: Date!, $h: String!) { viewer { zones(filter: { zoneTag: $z }) {
				httpRequestsAdaptiveGroups(limit: 20, filter: { date_geq: $d, date_lt: $n, clientRequestHTTPHost: $h }) { count sum { edgeResponseBytes } dimensions { cacheStatus } } } } }`,
			{ z: ZONE_ID, d: day, n: next, h: env.MEDIA_PUBLIC_HOST ?? '' },
		);
		const http = data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
		const requests = http.reduce((n: number, g: any) => n + (g.count ?? 0), 0);
		const hits = http.filter((g: any) => ['hit', 'stale', 'revalidated', 'updating'].includes(g.dimensions?.cacheStatus)).reduce((n: number, g: any) => n + (g.count ?? 0), 0);
		const bytes = http.reduce((n: number, g: any) => n + (g.sum?.edgeResponseBytes ?? 0), 0);
		out.extra.push(
			{ provider: 'r2', metric: 'cdn_requests', value: requests },
			{ provider: 'r2', metric: 'cdn_hit_ratio', value: requests ? hits / requests : 0 },
			{ provider: 'r2', metric: 'cdn_edge_gb', value: bytes / GB },
		);
	} catch (error) {
		// Needs Zone → Analytics: Read on the token
		logger.warn('[MediaCosts] Media host analytics unavailable', { error: error instanceof Error ? error.message : String(error) });
	}
	return out;
}

/** Collect yesterday (UTC) and upsert its rows. Never throws. */
export async function collectDeliveryCosts(env: CostEnv, now = new Date()): Promise<{ day: string; metrics: number }> {
	const day = new Date(now.getTime() - 86400_000).toISOString().slice(0, 10);
	const db = env.SEARCH_DB;
	if (!db) return { day, metrics: 0 };
	try {
		const start = `${day}T00:00:00.000Z`;
		const end = new Date(Date.parse(start) + 86400_000).toISOString();
		const jobs = await db
			.prepare(
				`SELECT COALESCE(SUM(container_seconds), 0) AS cs, COALESCE(SUM(bytes), 0) AS b, COALESCE(SUM(objects), 0) AS o, COALESCE(SUM(duration_seconds), 0) AS vs
				 FROM media_jobs WHERE status = 'ready' AND ready_at >= ?1 AND ready_at < ?2`,
			)
			.bind(start, end)
			.first<{ cs: number; b: number; o: number; vs: number }>();
		const stored = await db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS b FROM media_jobs WHERE status = 'ready'`).first<{ b: number }>();
		const { results: qoe } = await db
			.prepare('SELECT provider, SUM(watch_ms) AS watchMs, SUM(kbps_watch_s) AS kbpsWatchS FROM playback_qoe_daily WHERE day = ?1 GROUP BY provider')
			.bind(day)
			.all<{ provider: string; watchMs: number; kbpsWatchS: number }>();
		const [bunnyBytes, cf] = await Promise.all([bunnyStoredBytes(env), cloudflareDay(env, day)]);
		const metrics = [
			...metricsFromRecords({
				jobs: { containerSeconds: jobs?.cs ?? 0, bytes: jobs?.b ?? 0, objects: jobs?.o ?? 0, videoSeconds: jobs?.vs ?? 0, storedBytes: stored?.b ?? 0 },
				qoe: qoe ?? [],
				bunnyStoredBytes: bunnyBytes,
				r2StoredBytes: cf.r2StoredBytes,
				r2ClassB: cf.r2ClassB,
			}),
			...cf.extra,
		];
		const at = new Date().toISOString();
		await db.batch(
			metrics.map((m) =>
				db
					.prepare(
						'INSERT INTO delivery_cost_daily (day, provider, metric, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (day, provider, metric) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
					)
					.bind(day, m.provider, m.metric, m.value, at),
			),
		);
		return { day, metrics: metrics.length };
	} catch (error) {
		logger.error('[MediaCosts] Collection failed', { day, error: error instanceof Error ? error.message : String(error) });
		return { day, metrics: 0 };
	}
}
