/**
 * /api/abuse — the admin Abuse panel (docs/features/bot-protection.md).
 *
 *   GET /summary?env=production|stage|qa&hours=1..168   counts per app, endpoint and kind
 *
 * Every Worker that checks Turnstile or a rate limit writes one Analytics Engine
 * point per outcome (dataset al_ummah_now_abuse[_stage|_qa]; blobs app, endpoint,
 * kind, env; no personal data). This reads them back with the Analytics Engine SQL
 * API (CF_ANALYTICS_TOKEN, Account Analytics Read). No D1 reads or writes; answers
 * are cached for 5 minutes per env and window. Needs `ops:read`.
 */
import { Hono, type Context } from 'hono';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { analyticsCredentials, analyticsQuery, AnalyticsEngineError, flagAnalyticsFailure, newErrorRef, resolveAnalyticsFailure } from '../lib/analytics-engine';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const ABUSE_DATASETS = {
	production: 'al_ummah_now_abuse',
	stage: 'al_ummah_now_abuse_stage',
	qa: 'al_ummah_now_abuse_qa',
} as const;
export type AbuseEnv = keyof typeof ABUSE_DATASETS;
export const ABUSE_KINDS = ['turnstile_pass', 'turnstile_fail', 'turnstile_missing', 'turnstile_error', 'rate_limited', 'bad_user_agent', 'native_proof_missing', 'bypass'] as const;
const CACHE_SECONDS = 300;

export interface AbuseRow {
	app: string;
	endpoint: string;
	kind: string;
	count: number;
}

export interface AbuseSummary {
	env: AbuseEnv;
	hours: number;
	generatedAt: string;
	rows: AbuseRow[];
	totals: Record<string, number>;
}

/** The SQL for one dataset and window. Both come from fixed lists, never from free input. */
export function abuseQuery(dataset: string, hours: number): string {
	return (
		`SELECT blob1 AS app, blob2 AS endpoint, blob3 AS kind, SUM(_sample_interval) AS n ` +
		`FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR ` +
		`GROUP BY app, endpoint, kind ORDER BY n DESC LIMIT 500`
	);
}

export function summarize(env: AbuseEnv, hours: number, data: Array<Record<string, unknown>>, now = new Date()): AbuseSummary {
	const rows: AbuseRow[] = data
		.map((r) => ({ app: String(r.app ?? ''), endpoint: String(r.endpoint ?? ''), kind: String(r.kind ?? ''), count: Math.round(Number(r.n ?? 0)) }))
		.filter((r) => r.endpoint && r.kind && r.count > 0);
	const totals: Record<string, number> = Object.fromEntries(ABUSE_KINDS.map((k) => [k, 0]));
	for (const r of rows) totals[r.kind] = (totals[r.kind] ?? 0) + r.count;
	return { env, hours, generatedAt: now.toISOString(), rows, totals };
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
	const env: AbuseEnv = envParam in ABUSE_DATASETS ? (envParam as AbuseEnv) : 'production';
	const hours = Math.min(168, Math.max(1, Math.floor(Number(c.req.query('hours') ?? 24)) || 24));

	const creds = await analyticsCredentials(c.env);
	if (!creds) {
		return c.json({ success: false, code: 'not_configured', error: 'Abuse counters are not configured here' }, 503);
	}

	const cacheKey = new Request(`https://abuse.cache.invalid/summary?env=${env}&hours=${hours}`);
	const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
	const hit = cache ? await cache.match(cacheKey).catch(() => undefined) : undefined;
	if (hit) return c.json({ success: true, result: await hit.json() });

	const defer = (p: Promise<unknown>) => {
		try {
			c.executionCtx.waitUntil(p);
		} catch {
			// outside a request (tests): the promise still runs
		}
	};
	let data: Array<Record<string, unknown>>;
	try {
		data = await analyticsQuery(creds.account, creds.token, abuseQuery(ABUSE_DATASETS[env], hours), { panel: 'abuse' });
	} catch (error) {
		const failure = error instanceof AnalyticsEngineError ? error : new AnalyticsEngineError('bad_response', 0, error instanceof Error ? error.message : String(error));
		const ref = newErrorRef();
		defer(flagAnalyticsFailure(c.env as never, 'abuse', failure, ref));
		return c.json({ success: false, code: 'unavailable', reason: failure.reason, ref, error: 'Abuse counters are unavailable right now' }, 503);
	}
	defer(resolveAnalyticsFailure(c.env as never, 'abuse'));
	const summary = summarize(env, hours, data);
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
