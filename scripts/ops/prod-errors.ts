/**
 * Read-only report of the errors one environment recorded (production or stage).
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node --experimental-strip-types scripts/ops/prod-errors.ts \
 *     --env production [--hours 72] [--paths /passkeys/,/account/passkeys] [--sealed report.sealed.json]
 *
 * --paths: also list every request whose path contains one of the
 * comma-separated substrings (time, method, path without query, status,
 * outcome, browser family) with the log lines of those requests (sealed report
 * only). The workflow input itself is public: never put an id or a name in it.
 *
 * Two outputs:
 *  - stdout (the workflow log and summary, which are public): the allow list of public-report.ts only, i.e. app,
 *    group id, kind, error class, route template, status, counts and times;
 *  - --sealed <file>: the full report, encrypted (seal.ts; open-report.ts opens it). Without --sealed it is
 *    dropped. It holds the error groups with their latest sample, the open "needs action" items, failed cost
 *    runs, and warn/error lines from Workers Observability; credentials, emails and addresses are scrubbed.
 *
 * D1 is read through the Cloudflare API with SELECT-only statements on indexed columns
 * (error_groups.last_seen, error_events (group_id, occurred_at), error_actions (status, updated_at)),
 * each bounded by LIMIT. No app endpoint is called and nothing is changed.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { publicErrors, type ErrorsData } from './public-report.ts';
import { clip, scrub } from './scrub.ts';
import { seal } from './seal.ts';

const API = 'https://api.cloudflare.com/client/v4';

export type EnvName = 'production' | 'stage';

/** admin-api's reports D1 (error tables), from apps/admin-api/wrangler.jsonc. */
export const REPORTS_D1: Record<EnvName, string> = {
	production: '7bee932d-c6b1-47c2-ab70-7dba349104af',
	stage: '2b2c07fc-2823-46e0-958f-acfc401544ff',
};

/** cost-monitor's D1 (collector runs, cost jobs), from apps/cost-monitor/wrangler.jsonc. */
export const COSTS_D1: Record<EnvName, string> = {
  production: 'af54e39e-6faa-4923-bba3-8dd7b3e58cf7',
  stage: 'd4c4d007-c691-4f92-a728-b2ecd706a3ae',
};

/** Failed or partial collector runs (idx_collector_runs_started); detail holds counts and error text only. */
export const COLLECTOR_RUNS_SQL = `SELECT kind, started_at, status, queries, rows_written, substr(detail, 1, 700) AS detail FROM collector_runs
 WHERE started_at >= ?1 AND status IN ('failed', 'partial') ORDER BY started_at DESC LIMIT 12`;

/** Failed cost jobs (idx_cost_job_runs_started). */
export const COST_JOB_RUNS_SQL = `SELECT job, started_at, status, attempts, substr(detail, 1, 400) AS detail FROM cost_job_runs
 WHERE started_at >= ?1 AND status = 'failed' ORDER BY started_at DESC LIMIT 20`;

/** Worker script names per environment (apps/* wrangler configs and AlUmmahNowAuth apps/*). */
export function scriptsFor(env: EnvName): Record<string, string[]> {
	const s = env === 'stage' ? '-stage' : '';
	return {
		web: env === 'stage' ? ['al-ummah-now-stage', 'al-ummah-now-staging'] : ['al-ummah-now-production'],
		'admin-web': [`al-ummah-admin-web${s}`],
		'api-videos': [`videos${s}`],
		'admin-api': [`al-ummah-admin-api${s}`],
		media: [`al-ummah-now-media${s}`],
		processor: [`al-ummah-now-processor${s}`],
		websocket: [`al-ummah-now-comms${s}`],
		scheduler: [`al-ummah-scheduler${s}`],
		auth: [`al-ummah-now-auth${s}`, `al-ummah-now-auth-admin${s}`, `al-ummah-now-profile${s}`],
	};
}

/** Items of child safety reports and cases (shared-types isChildSafetyErrorKey): never in this report. */
const SUPER_ADMINS_ONLY = "cs.item_key GLOB 'child-safety-*' OR cs.item_key GLOB 'csam[-:]*'";

/** SELECT-only, indexed (idx_error_groups_last_seen), bounded. */
export const GROUPS_SQL = `SELECT id, app, kind, name, message, culprit, route, status, occurrences, users, first_seen, last_seen,
 first_release, last_release, test FROM error_groups g WHERE last_seen >= ?1 AND environment = ?2
 AND NOT EXISTS (SELECT 1 FROM error_actions cs WHERE cs.group_id = g.id AND (${SUPER_ADMINS_ONLY})) ORDER BY last_seen DESC LIMIT 200`;

/** The latest sample of one group (idx_error_events_group). */
export const LATEST_EVENT_SQL = `SELECT occurred_at, release, worker_version, route, method, status, request_id, name, message,
 substr(coalesce(symbolicated_stack, stack), 1, 1500) AS stack, substr(extra_json, 1, 800) AS extra,
 json_extract(context_json, '$.origin') AS origin FROM error_events
 WHERE group_id = ?1 ORDER BY occurred_at DESC LIMIT 1`;

/** Open needs-action items (idx_error_actions_status). */
export const ACTIONS_SQL = `SELECT app, source, title, detail, item_type, item_id, status, occurrences, attempts, updated_at
 FROM error_actions cs WHERE status = 'open' AND updated_at >= ?1 AND environment = ?2 AND NOT (${SUPER_ADMINS_ONLY}) ORDER BY updated_at DESC LIMIT 100`;

/** Every statement this script sends: SELECT only. */
export const ALL_SQL = [GROUPS_SQL, LATEST_EVENT_SQL, ACTIONS_SQL, COLLECTOR_RUNS_SQL, COST_JOB_RUNS_SQL];

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

async function post(path: string, payload: unknown): Promise<{ ok: boolean; status: number; body: any }> {
	const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
	const body = await res.json().catch(() => null);
	return { ok: res.ok && body?.success !== false, status: res.status, body };
}

function errs(r: { status: number; body: any }): string {
	const b = r.body ?? {};
	return `HTTP ${r.status} ${clip(JSON.stringify(b.errors?.length ? b.errors : b), 600)}`;
}

/** "android 1.4.0 · phone · EG · search:google (www.google.com) · /:locale/video/:id" from context.origin JSON. */
export function originLine(json: string): string {
	try {
		const o = JSON.parse(json) as Record<string, string>;
		const app = [o.surface, o.appVersion].filter(Boolean).join(' ');
		const source = o.campaign ? `${o.source} (${o.campaign})` : o.referrerHost ? `${o.source} (${o.referrerHost})` : o.source;
		return [app, o.device, o.country, source, o.entry].filter(Boolean).join(' · ');
	} catch {
		return '–';
	}
}

/** The first `n` stack frames (lines starting with "at "), app frames first. */
export function topFrames(stack: string | null | undefined, n = 4): string[] {
	if (!stack) return [];
	const frames = stack.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at '));
	const app = frames.filter((f) => !/node_modules|node:internal|<anonymous>/.test(f));
	return (app.length ? app : frames).slice(0, n);
}

const out: string[] = [];
/** What the public part is made of */
const data: Pick<ErrorsData, 'groups' | 'actions' | 'collectorFailures' | 'logs'> = { groups: null, actions: null, collectorFailures: null, logs: [] };
const p = (s = '') => out.push(scrub(s));

async function d1(env: EnvName, sql: string, params: unknown[], db = REPORTS_D1[env]): Promise<{ ok: boolean; rows: any[]; error?: string }> {
	if (!/^\s*SELECT\b/i.test(sql)) throw new Error('SELECT only');
	const r = await post(`/accounts/${account}/d1/database/${db}/query`, { sql, params });
	if (!r.ok) return { ok: false, rows: [], error: errs(r) };
	return { ok: true, rows: r.body?.result?.[0]?.results ?? [] };
}

async function groups(env: EnvName, since: Date): Promise<void> {
	p('## Error groups seen in the window');
	const g = await d1(env, GROUPS_SQL, [since.toISOString(), env]);
	if (!g.ok) return p(`- not readable: ${g.error}`), p();
	p(`${g.rows.length} groups (test = only release-E2E controlled errors)`);
	data.groups = g.rows;
	p();
	for (const row of g.rows) {
		p(`### [${row.app}] ${row.kind} ${row.name ?? ''}: ${clip(row.message, 300)}`);
		p(`- group ${row.id}, status ${row.status}${row.test ? ', test' : ''}, ×${row.occurrences}, users ${row.users}`);
		p(`- route ${row.route ?? '–'}, culprit ${row.culprit ?? '–'}`);
		p(`- first ${row.first_seen} (${row.first_release ?? '–'}), last ${row.last_seen} (${row.last_release ?? '–'})`);
		const e = await d1(env, LATEST_EVENT_SQL, [row.id]);
		const ev = e.rows[0];
		if (ev) {
			row.http_status = ev.status;
			p(`- latest: ${ev.occurred_at} ${ev.method ?? ''} ${ev.route ?? ''} → ${ev.status ?? '–'}, release ${ev.release ?? '–'}, version ${ev.worker_version ?? '–'}, request ${ev.request_id ?? '–'}`);
			if (ev.message && ev.message !== row.message) p(`- latest message: ${clip(ev.message, 400)}`);
			if (ev.origin) p(`- origin: ${originLine(ev.origin)}`);
			for (const f of topFrames(ev.stack)) p(`  - ${clip(f, 240)}`);
			if (ev.extra) p(`- extra: ${ev.extra}`);
		} else if (!e.ok) p(`- latest sample not readable: ${e.error}`);
		p();
	}
}

async function actions(env: EnvName, since: Date): Promise<void> {
	p('## Open needs-action items');
	const a = await d1(env, ACTIONS_SQL, [since.toISOString(), env]);
	if (!a.ok) return p(`- not readable: ${a.error}`), p();
	p(`${a.rows.length} open`);
	data.actions = a.rows;
	for (const r of a.rows) p(`- ${r.updated_at} [${r.app}/${r.source}] ${r.title}: ${clip(r.detail, 300)} (${r.item_type ?? ''} ${r.item_id ?? ''}, ×${r.occurrences}, attempts ${r.attempts})`);
	p();
}

async function costRuns(env: EnvName, since: Date): Promise<void> {
	// Both tables or nothing: half a read is not "0 failed runs"
	let failures: number | null = 0;
	p('## Cost collector: failed runs');
	for (const [name, sql] of [['collector_runs', COLLECTOR_RUNS_SQL], ['cost_job_runs', COST_JOB_RUNS_SQL]] as const) {
		const r = await d1(env, sql, [since.toISOString()], COSTS_D1[env]);
		p(`### ${name}`);
		if (!r.ok) {
			p(`- not readable: ${r.error}`);
			failures = null;
			continue;
		}
		p(`${r.rows.length} rows`);
		if (failures !== null) failures += r.rows.length;
		for (const row of r.rows) p(`- ${JSON.stringify(row)}`);
	}
	data.collectorFailures = failures;
	p();
}

/** Browser and OS family only (never the full User-Agent). */
export function uaFamily(ua: unknown): string {
	const s = typeof ua === 'string' ? ua : '';
	if (!s) return '';
	const os = /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux|CrOS/.test(s) ? 'Linux' : 'other';
	const br = /Edg\//.test(s) ? 'Edge' : /SamsungBrowser/.test(s) ? 'Samsung' : /Firefox|FxiOS/.test(s) ? 'Firefox' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'other';
	return `${br}/${os}`;
}

/** Path of a request URL without host or query. */
export function pathOf(url: unknown): string {
	return String(url ?? '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]!.split('#')[0]!;
}

async function pathTrace(app: string, script: string, needles: string[], since: Date, until: Date): Promise<void> {
	p(`## Requests: ${app} (${script}) matching ${needles.join(', ')}`);
	// One query per needle, filtered on the request URL by Observability itself, so a
	// busy window's cap never hides the matching requests
	const all: any[] = [];
	for (const needle of needles) {
		const r = await post(`/accounts/${account}/workers/observability/telemetry/query`, {
			queryId: `prod-errors-paths-${script}`,
			timeframe: { from: since.getTime(), to: until.getTime() },
			view: 'events',
			limit: 2000,
			parameters: {
				datasets: ['cloudflare-workers'],
				filters: [
					{ key: '$workers.scriptName', operation: 'eq', type: 'string', value: script },
					...(needle === '/' ? [] : [{ key: '$workers.event.request.url', operation: 'includes', type: 'string', value: needle }]),
				],
				filterCombination: 'and',
			},
		});
		if (!r.ok) return p(`unavailable: ${errs(r)}`), p();
		all.push(...(r.body.result?.events?.events ?? []));
	}
	const hit = (e: any) => {
		const path = pathOf(e.$workers?.event?.request?.url ?? e.$workers?.event?.request?.path);
		return path && needles.some((n) => path.includes(n));
	};
	const matched = all.filter(hit);
	const ids = new Set(matched.map((e) => e.$workers?.requestId).filter(Boolean));
	p(`${matched.length} matching events (of ${all.length} read)`);
	const rows = all
		.filter((e) => hit(e) || (e.$workers?.requestId && ids.has(e.$workers.requestId)))
		.sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));
	for (const e of rows.slice(-200)) {
		const t = new Date(e.timestamp ?? e.$metadata?.timestamp ?? 0).toISOString();
		const req = e.$workers?.event?.request;
		const status = e.$workers?.event?.response?.status ?? '';
		const level = e.$metadata?.level ?? e.source?.level ?? '';
		const msg = clip(e.$metadata?.message ?? e.source?.message, 300);
		const ua = uaFamily(req?.headers?.['user-agent'] ?? req?.headers?.['User-Agent']);
		p(`- ${t} ${req?.method ?? ''} ${pathOf(req?.url ?? req?.path)} ${status ? `→ ${status}` : ''} ${e.$workers?.outcome ?? ''} ${ua} ${level ? `[${level}] ` : ''}${msg}`.replace(/\s+/g, ' ').trim());
	}
	p();
}

async function logs(app: string, script: string, since: Date, until: Date): Promise<void> {
	p(`## Logs: ${app} (${script})`);
	const r = await post(`/accounts/${account}/workers/observability/telemetry/query`, {
		queryId: `prod-errors-${script}`,
		timeframe: { from: since.getTime(), to: until.getTime() },
		view: 'events',
		limit: 1000,
		parameters: { datasets: ['cloudflare-workers'], filters: [{ key: '$workers.scriptName', operation: 'eq', type: 'string', value: script }], filterCombination: 'and' },
	});
	if (!r.ok) {
		data.logs.push({ app, warn: 0, error: 0, readable: false });
		return p(`unavailable: ${errs(r)}`), p();
	}
	const all = r.body.result?.events?.events ?? [];
	const events = all.filter((e: any) => /warn|error/i.test(String(e.$metadata?.level ?? e.source?.level ?? '')) || e.$workers?.outcome === 'exception');
	p(`${events.length} warn/error events (of ${all.length} read)`);
	const warn = events.filter((e: any) => /warn/i.test(String(e.$metadata?.level ?? e.source?.level ?? ''))).length;
	data.logs.push({ app, warn, error: events.length - warn, readable: true });
	// Collapse repeats: same level + message → one line with a count and the latest time
	const seen = new Map<string, { n: number; last: string; sample: string }>();
	for (const e of events) {
		const t = new Date(e.timestamp ?? e.$metadata?.timestamp ?? 0).toISOString();
		const level = e.$metadata?.level ?? e.source?.level ?? e.$workers?.outcome ?? '';
		const msg = clip(e.$metadata?.message ?? e.source?.message ?? e.$metadata?.error, 300);
		const req = e.$workers?.event?.request;
		const where = req ? `${req.method ?? ''} ${String(req.url ?? req.path ?? '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]}` : e.$workers?.eventType ?? '';
		const key = `${level}|${msg.replace(/[0-9a-f]{8,}|\d+/g, '#')}`;
		const sample = clip(typeof e.source === 'object' ? JSON.stringify(e.source) : e.source, 600);
		const cur = seen.get(key);
		if (cur) {
			cur.n++;
			if (t > cur.last) cur.last = t;
		} else seen.set(key, { n: 1, last: `${t}`, sample: `[${level}] ${where} ${msg} ${sample}` });
	}
	for (const v of [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 60)) p(`- ×${v.n} last ${v.last} ${v.sample}`);
	p();
}

async function main(): Promise<void> {
	if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
	const env = arg('env', 'production') as EnvName;
	if (!['production', 'stage'].includes(env)) throw new Error('--env must be production or stage');
	const hours = Math.min(168, Math.max(1, Number(arg('hours', '72')) || 72));
	const until = new Date();
	const since = new Date(until.getTime() - hours * 3600_000);
	p(`# Errors: ${env}, ${since.toISOString()} → ${until.toISOString()}`);
	p();
	await groups(env, since);
	await actions(env, since);
	await costRuns(env, since);
	// Observability keeps 7 days at most; the query window is capped at 72 h to bound the read
	const logSince = new Date(Math.max(since.getTime(), until.getTime() - 72 * 3600_000));
	for (const [app, scripts] of Object.entries(scriptsFor(env))) for (const s of scripts) await logs(app, s, logSince, until);
	const needles = arg('paths', '').split(',').map((n) => n.trim()).filter((n) => n.startsWith('/')).slice(0, 10);
	if (needles.length) for (const [app, scripts] of Object.entries(scriptsFor(env))) for (const s of scripts) await pathTrace(app, s, needles, logSince, until);
	const sealedPath = arg('sealed', '');
	if (sealedPath) writeFileSync(sealedPath, JSON.stringify(seal(out.join('\n') + '\n')));
	process.stdout.write(publicErrors({ env, since, until, ...data }).join('\n') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		// The log is public: the reason goes into the sealed report only
		const sealedPath = arg('sealed', '');
		if (sealedPath) writeFileSync(sealedPath, JSON.stringify(seal(scrub(`${out.join('\n')}\nfailed: ${error instanceof Error ? error.stack : String(error)}\n`))));
		process.stderr.write('prod-errors failed; the reason is in the sealed report\n');
		process.exit(1);
	});
}
