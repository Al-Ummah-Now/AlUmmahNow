/**
 * Read-only diagnostics of the R2 transcode pipeline (apps/media) in one environment.
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node --experimental-strip-types scripts/ops/media-diagnostics.ts \
 *     --env production [--hours 6] [--search "Could not start job"]
 *
 * Prints, as markdown (stdout, also the job summary):
 *  - the media Worker's recent deployments (a `wrangler deploy` restarts its containers)
 *  - the transcode queue and its DLQ: backlog over the window (GraphQL Analytics)
 *  - the Transcoder container application and its instances (state, as Cloudflare reports it)
 *  - warn/error log lines of the media Worker, api-videos and admin-api over the window (Workers
 *    Observability query; these Workers log warn/error only)
 *  - the Delivery page's cost inputs over 30 days: R2 jobs by status, retries and length, the
 *    collector's daily cost metrics per provider, viewer-hours per provider (read-only aggregates)
 *  - transcode start times over the last 30 days: queued → the container running FFmpeg, p50/p95
 *    (a read-only SELECT of api-videos' own media_jobs timestamps in the search D1), then the three
 *    slowest starts with their video and job ids, times, attempts and error, and the media Worker's
 *    warn/error lines around each (to tell a backlog, a retry, a source wait or an image pull apart).
 *    Video and job ids are opaque; no titles or user data are printed.
 *
 * Only al-ummah resources are named and read. Calls are GET lists/reads, the GraphQL Analytics
 * read and the Observability telemetry query (a POST that only reads). The token is never printed;
 * log lines are printed as the Workers wrote them (the logger redacts secrets, tokens and emails).
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';

type EnvName = 'production' | 'stage' | 'qa';

export interface Names {
	media: string;
	videos: string;
	admin: string;
	/** The web app and the Auth issuer: a sign-in's redirect and the pages it lands on */
	web: string;
	auth: string;
	queue: string;
	dlq: string;
}

/** api-videos' search D1 (media_jobs) per environment, from apps/api-videos/wrangler*.jsonc. */
export const SEARCH_D1: Record<EnvName, string> = {
	production: '41064871-cf1f-46e9-b102-7b913240ad89',
	stage: '956a3550-bd20-4cfc-9bf2-b1c2265b33dd',
	qa: '0282bac3-5b70-4343-a991-937c732d981a',
};

export function namesFor(env: EnvName): Names {
	if (env === 'production') return { web: 'al-ummah-now-production', auth: 'al-ummah-now-auth', media: 'al-ummah-now-media', videos: 'videos', admin: 'al-ummah-admin-api', queue: 'al-ummah-now-transcode', dlq: 'al-ummah-now-transcode-dlq' };
	if (env === 'stage') return { web: 'al-ummah-now-stage', auth: 'al-ummah-now-auth-stage', media: 'al-ummah-now-media-stage', videos: 'videos-stage', admin: 'al-ummah-admin-api-stage', queue: 'al-ummah-now-transcode-stage', dlq: 'al-ummah-now-transcode-dlq-stage' };
	return { web: 'al-ummah-web-qa', auth: 'al-ummah-now-auth-qa', media: 'al-ummah-now-media-qa', videos: 'videos-qa', admin: 'al-ummah-admin-api-qa', queue: 'al-ummah-now-transcode-qa', dlq: 'al-ummah-now-transcode-dlq-qa' };
}

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

async function get(path: string): Promise<{ ok: boolean; status: number; body: any }> {
	const res = await fetch(`${API}${path}`, { headers });
	const body = await res.json().catch(() => null);
	return { ok: res.ok && body?.success !== false, status: res.status, body };
}

async function post(path: string, payload: unknown): Promise<{ ok: boolean; status: number; body: any }> {
	const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
	const body = await res.json().catch(() => null);
	return { ok: res.ok && body?.success !== false, status: res.status, body };
}

function errs(r: { status: number; body: any }): string {
	const b = r.body ?? {};
	const detail = b.errors?.length ? b.errors : b.messages?.length ? b.messages : b.error ?? b.message ?? b;
	const text = JSON.stringify(detail);
	return `HTTP ${r.status} ${text.length > 900 ? text.slice(-900) : text}`;
}

/**
 * Printed text loses URL query strings (signed Bunny/R2 URLs carry tokens there) and anything that
 * looks like a credential: bearer tokens, JWTs, key/token/secret/signature/password fields.
 */
export function scrub(text: string): string {
	return text
		.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']*/g, '$1?…')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer …')
		.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '…jwt…')
		.replace(/("?(?:[a-z_-]*(?:token|secret|password|signature|api[_-]?key|authorization|x-amz-[a-z-]+))"?\s*[:=]\s*)("[^"]*"|[^\s,}&]+)/gi, '$1"…"');
}

const out: string[] = [];
const p = (s = '') => out.push(scrub(s));

async function deployments(names: Names): Promise<void> {
	p(`## ${names.media}: deployments`);
	const r = await get(`/accounts/${account}/workers/scripts/${names.media}/deployments`);
	if (!r.ok) return p(`unavailable: ${errs(r)}`), p();
	for (const d of (r.body.result?.deployments ?? []).slice(0, 8)) {
		p(`- ${d.created_on} ${d.source ?? ''} ${d.annotations?.['workers/message'] ?? ''} ${(d.versions ?? []).map((v: any) => `${v.version_id}@${v.percentage}%`).join(' ')}`);
	}
	p();
}

async function queues(names: Names, since: Date, until: Date): Promise<void> {
	p(`## Queues`);
	const r = await get(`/accounts/${account}/queues?per_page=100`);
	if (!r.ok) return p(`unavailable: ${errs(r)}`), p();
	const mine = (r.body.result ?? []).filter((q: any) => q.queue_name === names.queue || q.queue_name === names.dlq);
	for (const q of mine) {
		p(`### ${q.queue_name} (${q.queue_id})`);
		p(`- consumers: ${JSON.stringify((q.consumers ?? []).map((c: any) => ({ script: c.script ?? c.service, settings: c.settings, dlq: c.dead_letter_queue })))}`);
		const gql = await post('/graphql', {
			query: `query($a: String!, $q: String!, $s: Time!, $u: Time!) { viewer { accounts(filter: {accountTag: $a}) {
				queueBacklogAdaptiveGroups(limit: 500, filter: {queueId: $q, datetime_geq: $s, datetime_leq: $u}, orderBy: [datetimeMinute_ASC]) {
					dimensions { datetimeMinute } avg { messages bytes } }
				queueMessageOperationsAdaptiveGroups(limit: 500, filter: {queueId: $q, datetime_geq: $s, datetime_leq: $u}, orderBy: [datetimeMinute_ASC]) {
					dimensions { datetimeMinute actionType outcome consumerType } count sum { billableOperations } }
			} } }`,
			variables: { a: account, q: q.queue_id, s: since.toISOString(), u: until.toISOString() },
		});
		const acc = gql.body?.data?.viewer?.accounts?.[0];
		if (!acc) {
			p(`- analytics unavailable: ${JSON.stringify(gql.body?.errors ?? null).slice(0, 300)}`);
			continue;
		}
		const backlog = acc.queueBacklogAdaptiveGroups ?? [];
		// Every change of the backlog (not every minute)
		let last = -1;
		p(`- backlog changes (minute: messages):`);
		for (const b of backlog) {
			const m = Math.round(b.avg?.messages ?? 0);
			if (m !== last) p(`  - ${b.dimensions.datetimeMinute}: ${m}`);
			last = m;
		}
		p(`- operations:`);
		for (const o of acc.queueMessageOperationsAdaptiveGroups ?? []) {
			p(`  - ${o.dimensions.datetimeMinute} ${o.dimensions.actionType} ${o.dimensions.outcome ?? ''} ${o.dimensions.consumerType ?? ''} ×${o.count}`);
		}
	}
	p();
}

async function containers(names: Names): Promise<void> {
	p(`## Containers`);
	const r = await get(`/accounts/${account}/containers/applications`);
	if (!r.ok) return p(`unavailable: ${errs(r)}`), p();
	const apps = (r.body.result ?? []).filter((a: any) => typeof a.name === 'string' && a.name.startsWith(names.media) && (names.media !== 'al-ummah-now-media' || !/-(stage|qa)/.test(a.name)));
	for (const a of apps) {
		p(`### ${a.name} (${a.id})`);
		p(`- version ${a.version}, instances ${a.instances}, max ${a.max_instances}, image ${a.configuration?.image ?? ''}, updated ${a.updated_at ?? ''}`);
		p(`- health: ${JSON.stringify(a.health ?? null)}`);
		p(`- rollout: ${JSON.stringify(a.active_rollout_id ?? a.rollout ?? null)}`);
		for (const path of [`/accounts/${account}/containers/applications/${a.id}/instances`, `/accounts/${account}/containers/applications/${a.id}/rollouts`]) {
			const x = await get(path);
			p(`- GET …${path.split(a.id)[1]}: ${x.ok ? JSON.stringify(x.body.result ?? null).slice(0, 4000) : errs(x)}`);
		}
	}
	if (!apps.length) p(`(no application named ${names.media}*)`);
	p();
	await containerQuota(r.body.result ?? []);
}

/**
 * The account's container quota, as Cloudflare reports it (read-only): the account limits endpoints and
 * every container application's reserved vCPU (max_instances x the instance type's vCPU). A deploy is
 * refused when the account's applications together would reserve more vCPU than the quota.
 */
async function containerQuota(all: any[]): Promise<void> {
	p('## Container quota (account)');
	for (const path of [`/accounts/${account}/cloudchamber/me`, `/accounts/${account}/containers/me`]) {
		const x = await get(path);
		p(`- GET ${path.replace(account, '…')}: ${x.ok ? JSON.stringify(x.body.result ?? null).slice(0, 3000) : errs(x)}`);
	}
	let reserved = 0;
	for (const a of all) {
		const vcpu = Number(a.configuration?.vcpu ?? a.configuration?.instance_type?.vcpu ?? NaN);
		const type = a.instance_type ?? a.configuration?.instance_type ?? '';
		const v = Number.isFinite(vcpu) ? vcpu : null;
		if (v !== null) reserved += v * Number(a.max_instances ?? 0);
		p(`- app ${a.name}: max_instances ${a.max_instances}, instance_type ${JSON.stringify(type)}, vcpu ${v ?? '?'}, memory ${a.configuration?.memory ?? a.configuration?.memory_mib ?? '?'}, disk ${JSON.stringify(a.configuration?.disk ?? null)}`);
	}
	p(`- reserved vCPU across the ${all.length} applications (where the vcpu is reported): ${reserved}`);
	p();
}

async function logs(script: string, since: Date, until: Date, search: string, key = '$workers.scriptName', allLevels = false): Promise<void> {
	p(`## Logs: ${script}${key === '$workers.scriptName' ? '' : ` (${key})`}`);
	const filters: unknown[] = [{ key, operation: 'eq', type: 'string', value: script }];
	if (search) filters.push({ key: '$metadata.message', operation: 'includes', type: 'string', value: search });
	const r = await post(`/accounts/${account}/workers/observability/telemetry/query`, {
		queryId: `media-diagnostics-${script}`,
		timeframe: { from: since.getTime(), to: until.getTime() },
		view: 'events',
		limit: 1000,
		parameters: { datasets: key === '$workers.scriptName' ? ['cloudflare-workers'] : [], filters, filterCombination: 'and' },
	});
	if (!r.ok) return p(`unavailable: ${errs(r)}`), p();
	// warn/error only (these Workers log nothing else; invocation events and console.log are left out)
	const events = (r.body.result?.events?.events ?? []).filter((e: any) => allLevels || /warn|error/i.test(String(e.$metadata?.level ?? e.source?.level ?? '')));
	p(`${events.length} events`);
	const rows = events
		.map((e: any) => {
			const t = new Date(e.timestamp ?? e.$metadata?.timestamp ?? 0).toISOString();
			const level = e.$metadata?.level ?? e.source?.level ?? '';
			const msg = e.$metadata?.message ?? e.source?.message ?? '';
			const trigger = e.$workers?.event?.queue ? 'queue' : e.$workers?.eventType ?? '';
			const c = e.$container ? ` {placement:${e.$container.placementId ?? ''},host:${e.$container.hostname ?? ''},v:${e.$container.version ?? ''}}` : '';
			const src = (typeof e.source === 'object' ? JSON.stringify(e.source).slice(0, 700) : String(e.source ?? '').slice(0, 700)) + c;
			return `- ${t} [${level}] ${trigger} ${msg} ${src}`;
		})
		.sort();
	for (const row of rows) p(row);
	p();
}

async function discover(names: Names, since: Date, until: Date): Promise<void> {
	p(`## Observability: where the container logs are`);
	const timeframe = { from: since.getTime(), to: until.getTime() };
	for (const key of ['$metadata.service', '$workers.scriptName', '$metadata.type', 'dataset']) {
		const r = await post(`/accounts/${account}/workers/observability/telemetry/values`, { key, type: 'string', timeframe, limit: 200, datasets: [] });
		const vals = (r.body?.result ?? []).map((v: any) => String(v.value)).filter((v: string) => key !== '$metadata.service' && key !== '$workers.scriptName' ? true : v.includes(names.media.replace(/-(stage|qa)$/, '')));
		p(`- ${key}: ${r.ok ? JSON.stringify(vals).slice(0, 1500) : errs(r)}`);
	}
	const k = await post(`/accounts/${account}/workers/observability/telemetry/keys`, { timeframe, limit: 1000, datasets: [] });
	const keys = (k.body?.result ?? []).map((x: any) => String(x.key)).filter((x: string) => /contain|instance|exit|stream|service|dataset|app/i.test(x));
	p(`- keys: ${k.ok ? JSON.stringify(keys).slice(0, 2000) : errs(k)}`);
	// Container output, wherever it is: every event whose service names the transcoder application
	// By application id (from the Containers API), so only our own application is read
	const apps = await get(`/accounts/${account}/containers/applications`);
	const mine = (apps.body?.result ?? []).filter((a: any) => typeof a.name === 'string' && a.name.startsWith(names.media) && (names.media !== 'al-ummah-now-media' || !/-(stage|qa)/.test(a.name)));
	for (const a of mine) await logs(a.id, since, until, '', '$container.applicationId', true);
	p();
}

/** The p-th percentile (0..100) of sorted numbers, nearest rank; null when empty. */
export function percentile(sorted: number[], p: number): number | null {
	if (!sorted.length) return null;
	const rank = Math.ceil((p / 100) * sorted.length);
	return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

/**
 * Start time of a transcode: media_jobs.queued_at (api-videos queued it) → started_at (the container
 * accepted the job and FFmpeg started: the Transcoder's 'started' event). Includes the queue's
 * delivery, any wait for a free slot and the container's cold start. First attempts only (a retry
 * waits on purpose). Read-only aggregate; prints no ids.
 */
export const START_TIMES_SQL = `SELECT CAST((julianday(started_at) - julianday(queued_at)) * 86400000 AS INTEGER) AS ms
 FROM media_jobs WHERE started_at IS NOT NULL AND queued_at >= datetime('now', '-30 days') AND attempts <= 1 ORDER BY ms LIMIT 5000`;

/** The slowest first-attempt starts (read-only): what each waited on. */
export const SLOWEST_STARTS_SQL = `SELECT video_id, job_id, status, reason, attempts, queued_at, started_at, ready_at, failed_at, error, container_seconds, instance_type,
 CAST((julianday(started_at) - julianday(queued_at)) * 86400000 AS INTEGER) AS ms
 FROM media_jobs WHERE started_at IS NOT NULL AND queued_at >= datetime('now', '-30 days') AND attempts <= 1 ORDER BY ms DESC LIMIT 3`;

export function startTimeSummary(values: number[]): string {
	const ms = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
	if (!ms.length) return 'no transcodes started in the last 30 days';
	const s = (v: number | null) => (v === null ? '–' : `${(v / 1000).toFixed(1)} s`);
	return `${ms.length} transcodes: p50 ${s(percentile(ms, 50))}, p95 ${s(percentile(ms, 95))}, fastest ${s(ms[0]!)}, slowest ${s(ms[ms.length - 1]!)}`;
}

async function startTimes(env: EnvName): Promise<void> {
	p('## Transcode start times (30 days: queued → FFmpeg running, first attempts)');
	const r = await post(`/accounts/${account}/d1/database/${SEARCH_D1[env]}/query`, { sql: START_TIMES_SQL });
	if (!r.ok) {
		p(`- not readable: ${errs(r)}`);
		p();
		return;
	}
	const rows: { ms: number }[] = r.body?.result?.[0]?.results ?? [];
	p(`- ${startTimeSummary(rows.map((x) => Number(x.ms)))}`);
	p();
	const slow = await post(`/accounts/${account}/d1/database/${SEARCH_D1[env]}/query`, { sql: SLOWEST_STARTS_SQL });
	const worst: Record<string, unknown>[] = slow.ok ? (slow.body?.result?.[0]?.results ?? []) : [];
	p('### Slowest starts');
	if (!slow.ok) p(`- not readable: ${errs(slow)}`);
	for (const w of worst) p(`- ${JSON.stringify(w)}`);
	p();
	// The media Worker's own lines around each slow start: why it waited
	for (const w of worst) {
		const queued = Date.parse(String(w.queued_at));
		const started = Date.parse(String(w.started_at));
		if (!Number.isFinite(queued) || !Number.isFinite(started)) continue;
		await logs(namesFor(env).media, new Date(queued - 120_000), new Date(started + 120_000), '');
	}
}

/**
 * The Delivery page's cost inputs over 30 days (read-only aggregates, the same tables its /summary
 * reads): R2 jobs (seconds of video, container seconds, bytes) split by status, attempts and length,
 * the collector's daily cost metrics per provider, and viewer-hours per provider from the players.
 */
export const COST_INPUT_SQL = {
	jobs: `SELECT status, attempts > 1 AS retried, duration_seconds < 60 AS short, COUNT(*) AS n, SUM(duration_seconds) AS video_s,
 SUM(container_seconds) AS container_s, SUM(bytes) AS bytes FROM media_jobs WHERE queued_at >= datetime('now', '-30 days')
 GROUP BY status, retried, short ORDER BY status, retried, short`,
	costs: `SELECT provider, metric, COUNT(*) AS days, SUM(value) AS total FROM delivery_cost_daily
 WHERE day >= date('now', '-30 days') GROUP BY provider, metric ORDER BY provider, metric`,
	viewers: `SELECT provider, SUM(sessions) AS sessions, SUM(watch_ms) / 3600000.0 AS viewer_hours, SUM(kbps_watch_s) AS kbps_watch_s,
 SUM(watch_ms) AS watch_ms FROM playback_qoe_daily WHERE day >= date('now', '-30 days') GROUP BY provider`,
} as const;

async function costInputs(env: EnvName): Promise<void> {
	p('## Delivery cost inputs (30 days)');
	for (const [name, sql] of Object.entries(COST_INPUT_SQL)) {
		const r = await post(`/accounts/${account}/d1/database/${SEARCH_D1[env]}/query`, { sql });
		p(`### ${name}`);
		if (!r.ok) {
			p(`- not readable: ${errs(r)}`);
			continue;
		}
		for (const row of r.body?.result?.[0]?.results ?? []) p(`- ${JSON.stringify(row)}`);
	}
	p();
}

/** api-videos' read-only Auth D1 binding per environment (the Auth issuer's database), for its query analytics. */
export const AUTH_D1: Record<EnvName, string> = {
	production: 'af76f007-e21e-43aa-88de-ebfefe46fb56',
	stage: 'c7886ef6-c70b-4b7f-a65b-3df9f9aba9e2',
	qa: '',
};

/**
 * The slowest D1 queries of the window, per database (Cloudflare GraphQL query analytics, read-only):
 * a long query blocks every other query on a D1 database, sign-in included (Auth D1, 2026-11-13).
 */
async function slowQueries(env: EnvName, since: Date, until: Date): Promise<void> {
	p('## Slowest D1 queries in the window');
	for (const [name, id] of [['auth', AUTH_D1[env]], ['search', SEARCH_D1[env]]] as const) {
		if (!id) continue;
		const gql = await post('/graphql', {
			query: `query($a: String!, $d: String!, $s: Time!, $u: Time!) { viewer { accounts(filter: {accountTag: $a}) {
				d1QueriesAdaptiveGroups(limit: 12, filter: {databaseId: $d, datetime_geq: $s, datetime_leq: $u}, orderBy: [sum_queryDurationMs_DESC]) {
					count dimensions { query } avg { queryDurationMs } sum { queryDurationMs rowsRead rowsWritten } }
				d1AnalyticsAdaptiveGroups(limit: 300, filter: {databaseId: $d, datetime_geq: $s, datetime_leq: $u}, orderBy: [datetimeMinute_ASC]) {
					dimensions { datetimeMinute } sum { readQueries writeQueries } quantiles { queryBatchTimeMsP90 queryBatchTimeMsP99 } }
			} } }`,
			variables: { a: account, d: id, s: since.toISOString(), u: until.toISOString() },
		});
		const acc = gql.body?.data?.viewer?.accounts?.[0];
		p(`### ${name} D1`);
		if (!acc) {
			p(`- analytics unavailable: ${JSON.stringify(gql.body?.errors ?? null).slice(0, 300)}`);
			continue;
		}
		for (const q of acc.d1QueriesAdaptiveGroups ?? []) {
			p(`- avg ${Math.round(q.avg?.queryDurationMs ?? 0)} ms, ${q.count}x, total ${Math.round(q.sum?.queryDurationMs ?? 0)} ms, rows read ${q.sum?.rowsRead ?? 0}: ${String(q.dimensions?.query ?? '').replace(/\s+/g, ' ').slice(0, 260)}`);
		}
		p('- minutes with p99 batch time over 1 s:');
		for (const m of acc.d1AnalyticsAdaptiveGroups ?? []) {
			const p99 = m.quantiles?.queryBatchTimeMsP99 ?? 0;
			if (p99 > 1000) p(`  - ${m.dimensions.datetimeMinute}: p99 ${Math.round(p99)} ms, p90 ${Math.round(m.quantiles?.queryBatchTimeMsP90 ?? 0)} ms, reads ${m.sum?.readQueries ?? 0}, writes ${m.sum?.writeQueries ?? 0}`);
		}
	}
	p();
}

async function main(): Promise<void> {
	if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
	const env = arg('env', 'production') as EnvName;
	if (!['production', 'stage', 'qa'].includes(env)) throw new Error('--env must be production, stage or qa');
	const hours = Math.min(72, Math.max(1, Number(arg('hours', '6')) || 6));
	const search = arg('search', '');
	const until = new Date();
	const since = new Date(until.getTime() - hours * 3600_000);
	const names = namesFor(env);
	p(`# Media diagnostics: ${env}, ${since.toISOString()} → ${until.toISOString()}`);
	p();
	await deployments(names);
	await queues(names, since, until);
	await containers(names);
	await slowQueries(env, since, until);
	await startTimes(env);
	await costInputs(env);
	for (const s of [names.media, names.videos, names.admin, names.web, names.auth]) await logs(s, since, until, search);
	// Where the transcoder container's own output (stdout/stderr, exits) is: services and keys that mention it
	await discover(names, since, until);
	process.stdout.write(out.join('\n') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		process.stderr.write(`media-diagnostics failed: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}
