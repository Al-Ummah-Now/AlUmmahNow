/**
 * /api/vitals — the admin Web vitals panel (wiki AUN-SEO phase 4, docs/operations/rum.md).
 *
 *   GET /summary?env=production|stage|qa&days=1|7|28&locale=all|en|ar
 *
 * The videos site samples one page load in 20 and writes its field LCP, CLS and INP to Workers
 * Analytics Engine (apps/web app/api/rum, dataset al_ummah_now_rum[_stage|_qa]; blobs metric, page
 * kind, device, locale, environment; no URL, ids or personal data, D-SEO-9; automated browsers dropped). This reads the weighted p75 back
 * with the Analytics Engine SQL API (CF_ANALYTICS_TOKEN, Account Analytics Read), overall and per
 * page kind × device. No D1; answers are cached 5 minutes per env, window and locale. Needs `ops:read`.
 */
import { Hono, type Context } from 'hono';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

/** Same datasets as apps/web wrangler (RUM binding) and scripts/ops/rum-report.ts */
export const VITALS_DATASETS = {
	production: 'al_ummah_now_rum',
	stage: 'al_ummah_now_rum_stage',
	qa: 'al_ummah_now_rum_qa',
} as const;
export type VitalsEnv = keyof typeof VITALS_DATASETS;
export const VITALS_METRICS = ['LCP', 'CLS', 'INP'] as const;
export type VitalsMetric = (typeof VITALS_METRICS)[number];
export const VITALS_DAYS = [1, 7, 28] as const;
export const VITALS_LOCALES = ['all', 'en', 'ar'] as const;
export type VitalsLocale = (typeof VITALS_LOCALES)[number];
/** Good / poor limits (web.dev, at p75): LCP and INP in ms, CLS unitless */
export const VITALS_THRESHOLDS: Record<VitalsMetric, [number, number]> = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500] };
/** Below this many (sample-weighted) page loads a p75 is shown but marked as a small sample */
export const FEW_SAMPLES = 50;
const CACHE_SECONDS = 300;

export type VitalsRating = 'good' | 'needs_improvement' | 'poor';

export interface VitalsValue {
	p75: number;
	samples: number;
	rating: VitalsRating;
	few: boolean;
}

export interface VitalsRow {
	kind: string;
	device: string;
	metrics: Partial<Record<VitalsMetric, VitalsValue>>;
}

export interface VitalsSummary {
	env: VitalsEnv;
	days: number;
	locale: VitalsLocale;
	generatedAt: string;
	overall: Partial<Record<VitalsMetric, VitalsValue>>;
	rows: VitalsRow[];
}

export function rate(metric: VitalsMetric, p75: number): VitalsRating {
	const [good, poor] = VITALS_THRESHOLDS[metric];
	return p75 <= good ? 'good' : p75 <= poor ? 'needs_improvement' : 'poor';
}

/**
 * The SQL for one dataset, window and locale, grouped by `by` (none: one row per metric). Every
 * piece comes from the fixed lists above, never from free input.
 */
export function vitalsQuery(dataset: string, days: number, locale: VitalsLocale, by: 'metric' | 'detail', env?: VitalsEnv): string {
	const where = [`timestamp > NOW() - INTERVAL '${days}' DAY`];
	// Each env has its own dataset; blob5 (the writer's NEXTJS_ENV) also has to match, so a build bound
	// to the wrong dataset never mixes into another env's numbers
	if (env) where.push(`blob5 = '${env}'`);
	if (locale !== 'all') where.push(`blob4 = '${locale}'`);
	const dims = by === 'detail' ? 'blob1 AS metric, blob2 AS kind, blob3 AS device' : 'blob1 AS metric';
	const group = by === 'detail' ? 'metric, kind, device' : 'metric';
	return (
		`SELECT ${dims}, quantileExactWeighted(0.75)(double1, _sample_interval) AS p75, SUM(_sample_interval) AS n ` +
		`FROM ${dataset} WHERE ${where.join(' AND ')} GROUP BY ${group} ORDER BY ${group} LIMIT 500`
	);
}

function value(metric: VitalsMetric, r: Record<string, unknown>): VitalsValue | null {
	const p75 = Number(r.p75);
	const samples = Math.round(Number(r.n ?? 0));
	if (!Number.isFinite(p75) || p75 < 0 || samples <= 0) return null;
	return { p75, samples, rating: rate(metric, p75), few: samples < FEW_SAMPLES };
}

const isMetric = (m: unknown): m is VitalsMetric => (VITALS_METRICS as readonly unknown[]).includes(m);

/** Rows from the two queries (the SQL API returns numbers as strings) into the panel's shape */
export function summarizeVitals(
	env: VitalsEnv,
	days: number,
	locale: VitalsLocale,
	overallData: Array<Record<string, unknown>>,
	detailData: Array<Record<string, unknown>>,
	now = new Date(),
): VitalsSummary {
	const overall: VitalsSummary['overall'] = {};
	for (const r of overallData) {
		if (!isMetric(r.metric)) continue;
		const v = value(r.metric, r);
		if (v) overall[r.metric] = v;
	}
	const byKey = new Map<string, VitalsRow>();
	for (const r of detailData) {
		if (!isMetric(r.metric) || !r.kind || !r.device) continue;
		const v = value(r.metric, r);
		if (!v) continue;
		const key = `${r.kind}|${r.device}`;
		const row = byKey.get(key) ?? { kind: String(r.kind), device: String(r.device), metrics: {} };
		row.metrics[r.metric] = v;
		byKey.set(key, row);
	}
	// Busiest first: the page kinds and devices with the most loads lead
	const loads = (row: VitalsRow) => Math.max(0, ...Object.values(row.metrics).map((m) => m?.samples ?? 0));
	const rows = [...byKey.values()].sort((a, b) => loads(b) - loads(a) || a.kind.localeCompare(b.kind) || a.device.localeCompare(b.device));
	return { env, days, locale, generatedAt: now.toISOString(), overall, rows };
}

async function secret(binding: unknown): Promise<string> {
	if (typeof binding === 'string') return binding;
	try {
		return ((await (binding as { get?: () => Promise<string> })?.get?.()) ?? '') || '';
	} catch {
		return '';
	}
}

class Unavailable extends Error {}

/** One SQL API call; a dataset nobody has written to yet does not exist, which is "no data" */
async function query(account: string, token: string, sql: string): Promise<Array<Record<string, unknown>>> {
	let res: Response;
	try {
		res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: sql,
		});
	} catch (error) {
		logger.error('[Vitals] Analytics Engine unreachable', { error: error instanceof Error ? error.message : String(error) });
		throw new Unavailable();
	}
	const text = await res.text();
	if (!res.ok && /unknown table|does not exist|not found/i.test(text)) return [];
	if (!res.ok) {
		logger.error('[Vitals] Analytics Engine query failed', { status: res.status, body: text.slice(0, 300) });
		throw new Unavailable();
	}
	try {
		return ((JSON.parse(text) as { data?: Array<Record<string, unknown>> }).data ?? []) as Array<Record<string, unknown>>;
	} catch {
		return [];
	}
}

const app = new Hono<Env>();
const roles = (c: C) => normalizeRoles(c.get('auth')?.roles);

app.use('*', async (c, next) => {
	if (!hasPermission(roles(c), 'ops:read')) {
		return c.json({ success: false, code: 'forbidden', error: 'The ops:read permission is required' }, 403);
	}
	return next();
});

app.get('/summary', async (c) => {
	const envParam = (c.req.query('env') ?? (c.env as { ENVIRONMENT?: string }).ENVIRONMENT ?? 'production') as string;
	const env: VitalsEnv = envParam in VITALS_DATASETS ? (envParam as VitalsEnv) : 'production';
	const daysParam = Number(c.req.query('days') ?? 7);
	const days = (VITALS_DAYS as readonly number[]).includes(daysParam) ? daysParam : 7;
	const localeParam = c.req.query('locale') ?? 'all';
	const locale: VitalsLocale = (VITALS_LOCALES as readonly string[]).includes(localeParam) ? (localeParam as VitalsLocale) : 'all';

	const bindings = c.env as unknown as { CF_ANALYTICS_TOKEN?: unknown; CLOUDFLARE_ACCOUNT_ID?: string };
	const token = await secret(bindings.CF_ANALYTICS_TOKEN);
	const account = bindings.CLOUDFLARE_ACCOUNT_ID;
	if (!token || !account) {
		return c.json({ success: false, code: 'not_configured', error: 'Web vitals are not configured here' }, 503);
	}

	const cacheKey = new Request(`https://vitals.cache.invalid/summary?env=${env}&days=${days}&locale=${locale}`);
	const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
	const hit = cache ? await cache.match(cacheKey).catch(() => undefined) : undefined;
	if (hit) return c.json({ success: true, result: await hit.json() });

	let summary: VitalsSummary;
	try {
		const dataset = VITALS_DATASETS[env];
		const [overallData, detailData] = await Promise.all([
			query(account, token, vitalsQuery(dataset, days, locale, 'metric', env)),
			query(account, token, vitalsQuery(dataset, days, locale, 'detail', env)),
		]);
		summary = summarizeVitals(env, days, locale, overallData, detailData);
	} catch {
		return c.json({ success: false, code: 'unavailable', error: 'Web vitals are unavailable right now' }, 503);
	}
	if (cache) {
		const put = cache
			.put(cacheKey, new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` } }))
			.catch(() => undefined);
		try {
			c.executionCtx.waitUntil(put);
		} catch {
			await put;
		}
	}
	return c.json({ success: true, result: summary });
});

export default app;
