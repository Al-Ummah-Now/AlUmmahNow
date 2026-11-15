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
	queue: string;
	dlq: string;
}

export function namesFor(env: EnvName): Names {
	if (env === 'production') return { media: 'al-ummah-now-media', videos: 'videos', admin: 'al-ummah-admin-api', queue: 'al-ummah-now-transcode', dlq: 'al-ummah-now-transcode-dlq' };
	if (env === 'stage') return { media: 'al-ummah-now-media-stage', videos: 'videos-stage', admin: 'al-ummah-admin-api-stage', queue: 'al-ummah-now-transcode-stage', dlq: 'al-ummah-now-transcode-dlq-stage' };
	return { media: 'al-ummah-now-media-qa', videos: 'videos-qa', admin: 'al-ummah-admin-api-qa', queue: 'al-ummah-now-transcode-qa', dlq: 'al-ummah-now-transcode-dlq-qa' };
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
}

async function logs(script: string, since: Date, until: Date, search: string, key = '$workers.scriptName', allLevels = false): Promise<void> {
	p(`## Logs: ${script}${key === '$workers.scriptName' ? '' : ` (${key})`}`);
	const filters: unknown[] = [{ key, operation: 'eq', type: 'string', value: script }];
	if (search) filters.push({ key: '$metadata.message', operation: 'includes', type: 'string', value: search });
	const r = await post(`/accounts/${account}/workers/observability/telemetry/query`, {
		queryId: `media-diagnostics-${script}`,
		timeframe: { from: since.getTime(), to: until.getTime() },
		view: 'events',
		limit: 300,
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
			const src = typeof e.source === 'object' ? JSON.stringify(e.source).slice(0, 700) : '';
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
	for (const value of [`${names.media}-transcoder`, `${names.media}-transcoder-stage`]) {
		await logs(value, since, until, '', '$metadata.service', true);
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
	for (const s of [names.media, names.videos, names.admin]) await logs(s, since, until, search);
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
