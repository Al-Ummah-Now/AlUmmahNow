/**
 * Read-only 30-day Cloudflare usage report for al-ummah resources, priced at list prices.
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node --experimental-strip-types scripts/ops/usage-report.ts [--days 30]
 *
 * The account is shared with other projects. Resources are listed through the REST API and kept
 * only when their name is an al-ummah name (isAlUmmah); GraphQL is then filtered with `_in` to
 * those ids/names, so nothing about other projects is fetched or printed. Only GET list calls and
 * GraphQL reads are made. The token is never printed.
 *
 * Output: markdown (stdout, also the job summary) with per-product and per-env totals, the top
 * drivers in dollars, per-day trend for the biggest drivers, and the al-ummah Workers that look
 * like stale previews.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';

export type Env = 'production' | 'stage' | 'qa' | 'preview' | 'dev';

/**
 * Al-ummah names, taken from the wrangler configs of AlUmmahNow, AlUmmahNowAuth, AlUmmahNowUI and
 * AlUmmahNowCMS: Workers, D1 and KV start with al-ummah; the rest are the bucket and queue bases
 * below with an env suffix.
 */
const BASES = [
	'videos', 'channels', 'profiles', 'playlists', 'community-posts', 'subtitles', 'watch-history', 'scheduled-videos',
	'admin-backups', 'channel-sections', 'channel-tabs', 'global-settings', 'reports', 'theme-packages', 'upload-defaults',
	'audit-events', 'auth-moderation-requests', 'moderation-actions',
];
const SUFFIX = '(-(qa|stage|staging|preview|dev|pr-\\d+))*(-dlq)?(-(qa|stage|dev))?';
const BASE_RE = new RegExp(`^(${BASES.join('|')})${SUFFIX}$`);

export function isAlUmmah(name: string): boolean {
	const n = name.toLowerCase();
	return /^(al-?ummah|alummah)/.test(n) || BASE_RE.test(n);
}

export function envOf(name: string): Env {
	const n = name.toLowerCase();
	if (/(^|-)(pr-?\d+|preview)($|-)/.test(n)) return 'preview';
	if (/-(dev|local)$/.test(n)) return 'dev';
	if (/(-|_)qa($|-|_)/.test(n)) return 'qa';
	if (/(-|_)(stage|staging)($|-|_)/.test(n)) return 'stage';
	return 'production';
}

/** Workers Paid list prices, USD (2026-11). Included allowances are account-wide and listed separately. */
export const PRICE = {
	base: 5,
	workerReqM: 0.3, // incl. 10M/month
	workerCpuMsM: 0.02, // incl. 30M ms
	d1ReadM: 0.001, // incl. 25B
	d1WriteM: 1, // incl. 50M
	d1GbMonth: 0.75, // incl. 5 GB
	kvReadM: 0.5, // incl. 10M
	kvWriteM: 5, // write, delete, list: incl. 1M each
	kvGbMonth: 0.5, // incl. 1 GB
	r2GbMonth: 0.015, // incl. 10 GB
	r2AM: 4.5, // incl. 1M
	r2BM: 0.36, // incl. 10M
	doReqM: 0.15, // incl. 1M
	doGbSecM: 12.5, // incl. 400k GB-s; 128 MB per active object
	doGbMonth: 0.2, // incl. 5 GB (SQLite)
	queueOpM: 0.4, // incl. 1M
	logsM: 0.6, // incl. 20M
	aiNeuronK: 0.011, // incl. 10k/day
};

export const ALLOWANCE = {
	workerReq: 10e6,
	workerCpuMs: 30e6,
	d1Read: 25e9,
	d1Write: 50e6,
	kvRead: 10e6,
	kvWrite: 1e6,
	r2A: 1e6,
	r2B: 10e6,
	r2Gb: 10,
	doReq: 1e6,
	doGbSec: 400e3,
	queueOp: 1e6,
	logs: 20e6,
};

const R2_CLASS_A = new Set([
	'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload',
	'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart', 'UploadPartCopy', 'ListParts', 'PutBucketEncryption',
	'PutBucketCors', 'PutBucketLifecycleConfiguration',
]);
const R2_FREE = new Set(['DeleteObject', 'DeleteObjects', 'DeleteBucket', 'AbortMultipartUpload']);

export interface Line {
	product: string;
	resource: string;
	env: Env;
	usage: string;
	usd: number;
	/** usd by day (YYYY-MM-DD) */
	daily: Record<string, number>;
}

type Json = Record<string, any>;

async function rest(token: string, path: string): Promise<any[]> {
	const out: any[] = [];
	for (let page = 1; page < 50; page++) {
		const sep = path.includes('?') ? '&' : '?';
		const res = await fetch(`${API}${path}${sep}page=${page}&per_page=100`, { headers: { Authorization: `Bearer ${token}` } });
		const body = (await res.json().catch(() => ({}))) as Json;
		if (!res.ok || body.success === false) throw new Error(`GET ${path.split('?')[0]} → HTTP ${res.status} ${(body.errors ?? []).map((e: Json) => e.message).join('; ').slice(0, 200)}`);
		const r = body.result;
		const items = Array.isArray(r) ? r : Array.isArray(r?.buckets) ? r.buckets : [];
		out.push(...items);
		const info = body.result_info;
		if (!info || items.length < 100 || (info.total_pages && page >= info.total_pages)) break;
		if (r?.buckets) break;
	}
	return out;
}

async function gql(token: string, query: string, variables: Json): Promise<{ data?: Json; error?: string }> {
	const res = await fetch(`${API}/graphql`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	});
	const body = (await res.json().catch(() => ({}))) as Json;
	const error = (body.errors ?? []).map((e: Json) => String(e.message)).join('; ').slice(0, 400) || (res.ok ? undefined : `HTTP ${res.status}`);
	return { data: body.data?.viewer?.accounts?.[0], error };
}

/** Windows of at most `step` days covering [start, end), as GraphQL Time values. */
function windows(start: Date, end: Date, step: number): [string, string][] {
	const out: [string, string][] = [];
	for (let s = new Date(start); s < end; ) {
		const e = new Date(Math.min(end.getTime(), s.getTime() + step * 86_400_000));
		out.push([s.toISOString(), e.toISOString()]);
		s = e;
	}
	return out;
}

/** Keeps only rows whose key is in the al-ummah set (second guard after the `_in` filter). */
const only = <T>(rows: T[] | undefined, allowed: Set<string>, key: (r: T) => string): T[] => (rows ?? []).filter((r) => allowed.has(key(r)));

const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);
const usd = (n: number) => `$${n.toFixed(2)}`;
/** A markdown table cell: backslashes first, then pipes; no line breaks. */
export const cell = (v: string) => v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export interface Report {
	lines: Line[];
	errors: string[];
	days: number;
	staleWorkers: { name: string; modified: string }[];
	crons: { name: string; crons: string[] }[];
	counts: Record<string, number>;
	usage: Record<string, number>;
	topQueries: { db: string; query: string; rowsRead: number; rowsWritten: number; count: number }[];
	start: string;
	end: string;
}

/** The statements behind each al-ummah database's rows read and written (normalized SQL, no values). */
async function d1TopQueries(token: string, account: string, d1Name: Map<string, string>, start: Date, end: Date) {
	if (!d1Name.size) return [];
	const out: { db: string; query: string; rowsRead: number; rowsWritten: number; count: number }[] = [];
	for (const [s, e] of windows(start, end, 1)) {
		const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!,$d:[String!]){viewer{accounts(filter:{accountTag:$a}){
			q: d1QueriesAdaptiveGroups(limit:2000, filter:{datetime_geq:$s, datetime_lt:$e, databaseId_in:$d}){ dimensions{databaseId query} sum{rowsRead rowsWritten} count } }}}`,
			{ a: account, s, e, d: [...d1Name.keys()] });
		if (r.error) throw new Error(r.error);
		for (const row of only(r.data?.q as any[], new Set(d1Name.keys()), (x) => x.dimensions.databaseId)) {
			const db = d1Name.get(row.dimensions.databaseId)!;
			const query = String(row.dimensions.query).replace(/\s+/g, ' ').slice(0, 160);
			const hit = out.find((o) => o.db === db && o.query === query);
			if (hit) {
				hit.rowsRead += row.sum.rowsRead; hit.rowsWritten += row.sum.rowsWritten; hit.count += row.count;
			} else out.push({ db, query, rowsRead: row.sum.rowsRead, rowsWritten: row.sum.rowsWritten, count: row.count });
		}
	}
	return out;
}

export async function collect(token: string, account: string, start: Date, end: Date): Promise<Report> {
	const days = (end.getTime() - start.getTime()) / 86_400_000;
	const errors: string[] = [];
	const lines: Line[] = [];
	const usage: Record<string, number> = {};
	const add = (k: string, v: number) => (usage[k] = (usage[k] ?? 0) + v);
	const safe = async <T>(label: string, f: () => Promise<T>, fallback: T): Promise<T> => {
		try {
			return await f();
		} catch (e) {
			errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
			return fallback;
		}
	};

	const scripts = (await safe('workers list', () => rest(token, `/accounts/${account}/workers/scripts`), [])).filter((s) => isAlUmmah(s.id));
	const d1s = (await safe('d1 list', () => rest(token, `/accounts/${account}/d1/database`), [])).filter((d) => isAlUmmah(d.name));
	const kvs = (await safe('kv list', () => rest(token, `/accounts/${account}/storage/kv/namespaces`), [])).filter((k) => isAlUmmah(k.title));
	const buckets = (await safe('r2 list', () => rest(token, `/accounts/${account}/r2/buckets`), [])).filter((b) => isAlUmmah(b.name));
	const dos = (await safe('do list', () => rest(token, `/accounts/${account}/workers/durable_objects/namespaces`), [])).filter((d) => isAlUmmah(d.script ?? ''));
	const queues = (await safe('queues list', () => rest(token, `/accounts/${account}/queues`), [])).filter((q) => isAlUmmah(q.queue_name ?? ''));
	const counts = { workers: scripts.length, d1: d1s.length, kv: kvs.length, r2: buckets.length, do: dos.length, queues: queues.length };

	const crons: { name: string; crons: string[] }[] = [];
	for (const s of scripts) {
		const sched = await safe(`schedules ${s.id}`, async () => {
			const res = await fetch(`${API}/accounts/${account}/workers/scripts/${s.id}/schedules`, { headers: { Authorization: `Bearer ${token}` } });
			const body = (await res.json()) as Json;
			return (body.result?.schedules ?? []).map((x: Json) => String(x.cron));
		}, [] as string[]);
		if (sched.length) crons.push({ name: s.id, crons: sched });
	}
	const staleWorkers = scripts
		.filter((s) => envOf(s.id) === 'preview' || envOf(s.id) === 'dev')
		.map((s) => ({ name: s.id, modified: String(s.modified_on ?? '').slice(0, 10) }));

	const byKey = new Map<string, Line>();
	const line = (product: string, resource: string, env: Env): Line => {
		const k = `${product}|${resource}`;
		let l = byKey.get(k);
		if (!l) {
			l = { product, resource, env, usage: '', usd: 0, daily: {} };
			byKey.set(k, l);
			lines.push(l);
		}
		return l;
	};
	const charge = (l: Line, date: string, v: number) => {
		l.usd += v;
		l.daily[date] = (l.daily[date] ?? 0) + v;
	};
	const tally = new Map<string, Record<string, number>>();
	const t = (l: Line, k: string, v: number) => {
		const m = tally.get(`${l.product}|${l.resource}`) ?? {};
		m[k] = (m[k] ?? 0) + v;
		tally.set(`${l.product}|${l.resource}`, m);
	};

	const wins = windows(start, end, 7);
	const scriptNames = scripts.map((s) => s.id);

	// Workers
	if (scriptNames.length) {
		for (const [s, e] of wins) {
			const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!,$w:[String!]){viewer{accounts(filter:{accountTag:$a}){
				w: workersInvocationsAdaptive(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, scriptName_in:$w}){ dimensions{scriptName date} sum{requests subrequests errors cpuTimeUs} } }}}`,
				{ a: account, s, e, w: scriptNames });
			if (r.error) errors.push(`workers ${s}: ${r.error}`);
			for (const row of only(r.data?.w, new Set(scriptNames), (x: any) => x.dimensions.scriptName)) {
				const name = row.dimensions.scriptName;
				const l = line('Workers', name, envOf(name));
				const req = row.sum.requests, cpuMs = row.sum.cpuTimeUs / 1000;
				charge(l, row.dimensions.date, (req / 1e6) * PRICE.workerReqM + (cpuMs / 1e6) * PRICE.workerCpuMsM);
				t(l, 'req', req); t(l, 'sub', row.sum.subrequests); t(l, 'cpuMs', cpuMs);
				add('workerReq', req); add('workerCpuMs', cpuMs);
			}
		}
	}

	// D1
	const d1Name = new Map(d1s.map((d) => [d.uuid, d.name]));
	if (d1s.length) {
		for (const [s, e] of wins) {
			const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!,$d:[String!]){viewer{accounts(filter:{accountTag:$a}){
				q: d1AnalyticsAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, databaseId_in:$d}){ dimensions{databaseId date} sum{readQueries writeQueries rowsRead rowsWritten} }
				st: d1StorageAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, databaseId_in:$d}){ dimensions{databaseId date} max{databaseSizeBytes} } }}}`,
				{ a: account, s, e, d: [...d1Name.keys()] });
			if (r.error) errors.push(`d1 ${s}: ${r.error}`);
			for (const row of only(r.data?.q, new Set(d1Name.keys()), (x: any) => x.dimensions.databaseId)) {
				const name = d1Name.get(row.dimensions.databaseId) ?? row.dimensions.databaseId;
				const l = line('D1', name, envOf(name));
				charge(l, row.dimensions.date, (row.sum.rowsRead / 1e6) * PRICE.d1ReadM + (row.sum.rowsWritten / 1e6) * PRICE.d1WriteM);
				t(l, 'rowsRead', row.sum.rowsRead); t(l, 'rowsWritten', row.sum.rowsWritten); t(l, 'queries', row.sum.readQueries + row.sum.writeQueries);
				add('d1Read', row.sum.rowsRead); add('d1Write', row.sum.rowsWritten);
			}
			for (const row of only(r.data?.st, new Set(d1Name.keys()), (x: any) => x.dimensions.databaseId)) {
				const name = d1Name.get(row.dimensions.databaseId) ?? row.dimensions.databaseId;
				const l = line('D1 storage', name, envOf(name));
				const gb = row.max.databaseSizeBytes / 1024 ** 3;
				charge(l, row.dimensions.date, (gb * PRICE.d1GbMonth) / 30);
				t(l, 'gbDays', gb);
			}
		}
	}

	// KV
	const kvName = new Map(kvs.map((k) => [k.id, k.title]));
	if (kvs.length) {
		for (const [s, e] of wins) {
			const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!,$k:[String!]){viewer{accounts(filter:{accountTag:$a}){
				o: kvOperationsAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, namespaceId_in:$k}){ dimensions{namespaceId actionType date} sum{requests} }
				st: kvStorageAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, namespaceId_in:$k}){ dimensions{namespaceId date} max{byteCount keyCount} } }}}`,
				{ a: account, s, e, k: [...kvName.keys()] });
			if (r.error) errors.push(`kv ${s}: ${r.error}`);
			for (const row of only(r.data?.o, new Set(kvName.keys()), (x: any) => x.dimensions.namespaceId)) {
				const name = kvName.get(row.dimensions.namespaceId) ?? row.dimensions.namespaceId;
				const l = line('KV', name, envOf(name));
				const read = row.dimensions.actionType === 'read';
				charge(l, row.dimensions.date, (row.sum.requests / 1e6) * (read ? PRICE.kvReadM : PRICE.kvWriteM));
				t(l, row.dimensions.actionType, row.sum.requests);
				add(read ? 'kvRead' : 'kvWrite', row.sum.requests);
			}
			for (const row of only(r.data?.st, new Set(kvName.keys()), (x: any) => x.dimensions.namespaceId)) {
				const name = kvName.get(row.dimensions.namespaceId) ?? row.dimensions.namespaceId;
				const l = line('KV storage', name, envOf(name));
				charge(l, row.dimensions.date, ((row.max.byteCount / 1024 ** 3) * PRICE.kvGbMonth) / 30);
				t(l, 'keysMax', 0); // keep key
				const m = tally.get(`KV storage|${name}`)!;
				m.keysMax = Math.max(m.keysMax ?? 0, row.max.keyCount);
			}
		}
	}

	// R2
	const bucketNames = buckets.map((b) => b.name);
	if (bucketNames.length) {
		for (const [s, e] of wins) {
			const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!,$b:[String!]){viewer{accounts(filter:{accountTag:$a}){
				o: r2OperationsAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, bucketName_in:$b}){ dimensions{bucketName actionType date} sum{requests} }
				st: r2StorageAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, bucketName_in:$b}){ dimensions{bucketName date} max{payloadSize metadataSize objectCount} } }}}`,
				{ a: account, s, e, b: bucketNames });
			if (r.error) errors.push(`r2 ${s}: ${r.error}`);
			for (const row of only(r.data?.o, new Set(bucketNames), (x: any) => x.dimensions.bucketName)) {
				const name = row.dimensions.bucketName, act = row.dimensions.actionType;
				if (R2_FREE.has(act)) continue;
				const l = line('R2 ops', name, envOf(name));
				const a = R2_CLASS_A.has(act);
				charge(l, row.dimensions.date, (row.sum.requests / 1e6) * (a ? PRICE.r2AM : PRICE.r2BM));
				t(l, a ? 'classA' : 'classB', row.sum.requests);
				t(l, `op:${act}`, row.sum.requests);
				add(a ? 'r2A' : 'r2B', row.sum.requests);
			}
			for (const row of only(r.data?.st, new Set(bucketNames), (x: any) => x.dimensions.bucketName)) {
				const name = row.dimensions.bucketName;
				const l = line('R2 storage', name, envOf(name));
				const gb = (row.max.payloadSize + row.max.metadataSize) / 1024 ** 3;
				charge(l, row.dimensions.date, (gb * PRICE.r2GbMonth) / 30);
				const m = tally.get(`R2 storage|${name}`) ?? {};
				m.gbMax = Math.max(m.gbMax ?? 0, gb);
				m.objects = Math.max(m.objects ?? 0, row.max.objectCount);
				tally.set(`R2 storage|${name}`, m);
			}
		}
	}

	// Durable Objects
	const doName = new Map(dos.map((d) => [d.id, `${d.script}/${d.class}`]));
	if (dos.length) {
		for (const [s, e] of wins) {
			const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!,$n:[String!]){viewer{accounts(filter:{accountTag:$a}){
				p: durableObjectsPeriodicGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, namespaceId_in:$n}){ dimensions{namespaceId date} sum{activeTime cpuTime storageReadUnits storageWriteUnits inboundWebsocketMsgCount outboundWebsocketMsgCount subrequests} }
				i: durableObjectsInvocationsAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, namespaceId_in:$n}){ dimensions{namespaceId date} sum{requests} } }}}`,
				{ a: account, s, e, n: [...doName.keys()] });
			if (r.error) errors.push(`do ${s}: ${r.error}`);
			for (const row of only(r.data?.p, new Set(doName.keys()), (x: any) => x.dimensions.namespaceId)) {
				const name = doName.get(row.dimensions.namespaceId) ?? row.dimensions.namespaceId;
				const l = line('Durable Objects', name, envOf(name.split('/')[0]));
				const gbSec = (row.sum.activeTime / 1e6) * 0.125; // activeTime is µs
				// Incoming WebSocket messages bill as requests at 20:1
				const wsReq = row.sum.inboundWebsocketMsgCount / 20;
				charge(l, row.dimensions.date, (gbSec / 1e6) * PRICE.doGbSecM + (wsReq / 1e6) * PRICE.doReqM + (row.sum.storageReadUnits / 1e6) * PRICE.d1ReadM + (row.sum.storageWriteUnits / 1e6) * PRICE.d1WriteM);
				t(l, 'gbSec', gbSec); t(l, 'wsIn', row.sum.inboundWebsocketMsgCount); t(l, 'readUnits', row.sum.storageReadUnits); t(l, 'writeUnits', row.sum.storageWriteUnits);
				add('doGbSec', gbSec); add('doReq', wsReq);
			}
			for (const row of only(r.data?.i, new Set(doName.keys()), (x: any) => x.dimensions.namespaceId)) {
				const name = doName.get(row.dimensions.namespaceId) ?? row.dimensions.namespaceId;
				const l = line('Durable Objects', name, envOf(name.split('/')[0]));
				charge(l, row.dimensions.date, (row.sum.requests / 1e6) * PRICE.doReqM);
				t(l, 'req', row.sum.requests);
				add('doReq', row.sum.requests);
			}
		}
	}

	// Queues
	const qName = new Map(queues.map((q) => [q.queue_id, q.queue_name]));
	if (queues.length) {
		for (const [s, e] of wins) {
			const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!,$q:[String!]){viewer{accounts(filter:{accountTag:$a}){
				o: queueMessageOperationsAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, queueId_in:$q}){ count dimensions{queueId actionType date} sum{billableOperations} } }}}`,
				{ a: account, s, e, q: [...qName.keys()] });
			if (r.error) errors.push(`queues ${s}: ${r.error}`);
			for (const row of only(r.data?.o, new Set(qName.keys()), (x: any) => x.dimensions.queueId)) {
				const name = qName.get(row.dimensions.queueId) ?? row.dimensions.queueId;
				const l = line('Queues', name, envOf(name));
				const ops = row.sum?.billableOperations ?? row.count;
				charge(l, row.dimensions.date, (ops / 1e6) * PRICE.queueOpM);
				t(l, row.dimensions.actionType, ops);
				add('queueOp', ops);
			}
		}
	}

	// Workers AI (account-wide dataset; models are not per project, so it is reported as one line)
	for (const [s, e] of wins) {
		const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
			ai: aiInferenceAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e}){ dimensions{date modelId} sum{totalNeurons} count } }}}`,
			{ a: account, s, e });
		if (r.error) { errors.push(`ai ${s}: ${r.error}`); break; }
		for (const row of r.data?.ai ?? []) {
			const l = line('Workers AI (account)', row.dimensions.modelId, 'production');
			charge(l, row.dimensions.date, (row.sum.totalNeurons / 1000) * PRICE.aiNeuronK);
			t(l, 'neurons', row.sum.totalNeurons); t(l, 'calls', row.count);
		}
	}

	for (const l of lines) {
		const m = tally.get(`${l.product}|${l.resource}`) ?? {};
		l.usage = Object.entries(m)
			.filter(([k, v]) => v && !k.startsWith('op:'))
			.map(([k, v]) => `${k} ${k === 'gbMax' ? v.toFixed(2) : k === 'gbDays' ? (v / days).toFixed(3) + 'GB' : fmt(v)}`)
			.join(', ');
		const ops = Object.entries(m).filter(([k]) => k.startsWith('op:')).sort((a, b) => b[1] - a[1]).slice(0, 3);
		if (ops.length) l.usage += ` (${ops.map(([k, v]) => `${k.slice(3)} ${fmt(v)}`).join(', ')})`;
	}
	const topQueries = await safe('d1 queries', () => d1TopQueries(token, account, d1Name, start, end), []);
	return { lines, errors, days, staleWorkers, crons, counts, usage, topQueries, start: start.toISOString(), end: end.toISOString() };
}

export function render(r: Report): string {
	const scale = 30 / r.days;
	const out: string[] = [];
	const total = r.lines.reduce((s, l) => s + l.usd, 0);
	out.push(`# al-ummah Cloudflare usage, ${r.start.slice(0, 16)}Z → ${r.end.slice(0, 16)}Z (${r.days.toFixed(2)} days, scaled to 30; list prices before account allowances)`);
	out.push('');
	out.push(`Resources: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}. Total ≈ **${usd(total * scale)}/month** + $5 Workers Paid base.`);
	out.push('');
	const group = (key: (l: Line) => string) => {
		const m = new Map<string, number>();
		for (const l of r.lines) m.set(key(l), (m.get(key(l)) ?? 0) + l.usd);
		return [...m.entries()].sort((a, b) => b[1] - a[1]);
	};
	out.push('## By env\n\n| Env | $/month |\n|---|---|');
	for (const [k, v] of group((l) => l.env)) out.push(`| ${k} | ${usd(v * scale)} |`);
	out.push('\n## By product\n\n| Product | $/month |\n|---|---|');
	for (const [k, v] of group((l) => l.product)) out.push(`| ${k} | ${usd(v * scale)} |`);
	out.push('\n## By product × env\n\n| Product | Env | $/month |\n|---|---|---|');
	for (const [k, v] of group((l) => `${l.product}\u0000${l.env}`).slice(0, 30)) out.push(`| ${k.split('\u0000').map(cell).join(' | ')} | ${usd(v * scale)} |`);
	out.push('\n## Account usage vs included allowances (al-ummah share only)\n\n| Metric | Used / month | Included |\n|---|---|---|');
	for (const [k, inc] of Object.entries(ALLOWANCE)) out.push(`| ${k} | ${fmt((r.usage[k] ?? 0) * scale)} | ${fmt(inc)} |`);
	const top = [...r.lines].sort((a, b) => b.usd - a.usd).slice(0, 40);
	out.push('\n## Top 40 resources\n\n| # | Product | Resource | Env | $/month | Usage (period) |\n|---|---|---|---|---|---|');
	top.forEach((l, i) => out.push(`| ${i + 1} | ${l.product} | ${l.resource} | ${l.env} | ${usd(l.usd * scale)} | ${l.usage} |`));
	const dates = [...new Set(r.lines.flatMap((l) => Object.keys(l.daily)))].sort();
	out.push('\n## Daily total by env ($)\n\n| Date | ' + ['production', 'stage', 'qa', 'preview', 'dev'].join(' | ') + ' |\n|---|---|---|---|---|---|');
	for (const d of dates) {
		const by = (e: Env) => r.lines.filter((l) => l.env === e).reduce((s, l) => s + (l.daily[d] ?? 0), 0);
		out.push(`| ${d} | ${(['production', 'stage', 'qa', 'preview', 'dev'] as Env[]).map((e) => by(e).toFixed(2)).join(' | ')} |`);
	}
	out.push('\n## Top D1 statements by rows written\n\n| DB | Rows written | Rows read | Runs | Statement |\n|---|---|---|---|---|');
	for (const q of [...r.topQueries].sort((a, b) => b.rowsWritten - a.rowsWritten).slice(0, 25)) out.push(`| ${q.db} | ${fmt(q.rowsWritten)} | ${fmt(q.rowsRead)} | ${fmt(q.count)} | \`${cell(q.query)}\` |`);
	out.push('\n## Top D1 statements by rows read\n\n| DB | Rows read | Rows written | Runs | Statement |\n|---|---|---|---|---|');
	for (const q of [...r.topQueries].sort((a, b) => b.rowsRead - a.rowsRead).slice(0, 15)) out.push(`| ${q.db} | ${fmt(q.rowsRead)} | ${fmt(q.rowsWritten)} | ${fmt(q.count)} | \`${cell(q.query)}\` |`);
	out.push('\n## Top D1 statements by runs\n\n| DB | Runs | Rows read | Rows written | Statement |\n|---|---|---|---|---|');
	for (const q of [...r.topQueries].sort((a, b) => b.count - a.count).slice(0, 15)) out.push(`| ${q.db} | ${fmt(q.count)} | ${fmt(q.rowsRead)} | ${fmt(q.rowsWritten)} | \`${cell(q.query)}\` |`);
	out.push('\n## Cron triggers\n\n| Worker | Crons |\n|---|---|');
	for (const c of r.crons) out.push(`| ${c.name} | ${c.crons.join(', ')} |`);
	out.push('\n## Preview / dev Workers still deployed\n');
	out.push(r.staleWorkers.length ? r.staleWorkers.map((w) => `- ${w.name} (modified ${w.modified})`).join('\n') : '- none');
	if (r.errors.length) out.push('\n## Errors\n\n' + r.errors.map((e) => `- ${e}`).join('\n'));
	return out.join('\n') + '\n';
}

/**
 * The last `hours` hours, hour by hour, for the costliest Workers, D1 databases and R2 buckets of
 * the al-ummah set: shows whether a cost is a steady idle loop or bursts of test runs.
 */
export async function hourly(token: string, account: string, hours: number, now = new Date()): Promise<string> {
	const end = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
	const start = new Date(end.getTime() - hours * 3_600_000);
	const scripts = (await rest(token, `/accounts/${account}/workers/scripts`)).filter((x) => isAlUmmah(x.id)).map((x) => x.id);
	const d1s = (await rest(token, `/accounts/${account}/d1/database`)).filter((d) => isAlUmmah(d.name));
	const buckets = (await rest(token, `/accounts/${account}/r2/buckets`)).filter((b) => isAlUmmah(b.name)).map((b) => b.name);
	const d1Name = new Map(d1s.map((d) => [d.uuid, d.name]));
	// An empty `_in` list would not filter at all: never query with one
	if (!scripts.length || !d1Name.size || !buckets.length) return '## Hourly\n\nNo al-ummah resources listed (token scope?)\n';
	const r = await gql(token, `query($a:String!,$s:Time!,$e:Time!,$w:[String!],$d:[String!],$b:[String!]){viewer{accounts(filter:{accountTag:$a}){
		w: workersInvocationsAdaptive(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, scriptName_in:$w}){ dimensions{scriptName datetimeHour} sum{requests} }
		d: d1AnalyticsAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, databaseId_in:$d}){ dimensions{databaseId datetimeHour} sum{rowsRead rowsWritten} }
		r: r2OperationsAdaptiveGroups(limit:10000, filter:{datetime_geq:$s, datetime_lt:$e, bucketName_in:$b}){ dimensions{bucketName datetimeHour actionType} sum{requests} } }}}`,
		{ a: account, s: start.toISOString(), e: end.toISOString(), w: scripts, d: [...d1Name.keys()], b: buckets });
	const series = new Map<string, Map<string, number>>();
	const put = (k: string, h: string, v: number) => {
		const m = series.get(k) ?? new Map<string, number>();
		m.set(h, (m.get(h) ?? 0) + v);
		series.set(k, m);
	};
	for (const x of only(r.data?.w as any[], new Set(scripts), (y) => y.dimensions.scriptName)) put(`req ${x.dimensions.scriptName}`, x.dimensions.datetimeHour, x.sum.requests);
	for (const x of only(r.data?.d as any[], new Set(d1Name.keys()), (y) => y.dimensions.databaseId)) {
		const n = d1Name.get(x.dimensions.databaseId) ?? x.dimensions.databaseId;
		put(`d1w ${n}`, x.dimensions.datetimeHour, x.sum.rowsWritten);
		put(`d1r ${n}`, x.dimensions.datetimeHour, x.sum.rowsRead);
	}
	for (const x of only(r.data?.r as any[], new Set(buckets), (y) => y.dimensions.bucketName)) if (!R2_FREE.has(x.dimensions.actionType)) put(`r2 ${x.dimensions.bucketName} ${x.dimensions.actionType}`, x.dimensions.datetimeHour, x.sum.requests);
	const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
	const top = [...series.entries()].sort((a, b) => total(b[1]) - total(a[1])).slice(0, 14);
	const hoursList: string[] = [];
	for (let t = start.getTime(); t < end.getTime(); t += 3_600_000) hoursList.push(new Date(t).toISOString().replace('.000Z', 'Z'));
	const out = [`## Hourly, last ${hours} h (UTC), top series`, '', `| Hour | ${top.map(([k]) => k).join(' | ')} |`, `|---|${top.map(() => '---').join('|')}|`];
	for (const h of hoursList) out.push(`| ${h.slice(5, 13)} | ${top.map(([, m]) => fmt(m.get(h) ?? 0)).join(' | ')} |`);
	if (r.error) out.push('', `Errors: ${r.error}`);
	return out.join('\n') + '\n';
}

async function main() {
	const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
	const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
	const arg = (name: string) => {
		const i = process.argv.indexOf(name);
		return i > 0 ? process.argv[i + 1] : undefined;
	};
	const days = Math.max(1, Math.min(31, Number(arg('--days')) || 30));
	const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
	const end = arg('--until') ? new Date(arg('--until')!) : today;
	const start = arg('--since') ? new Date(arg('--since')!) : new Date(end.getTime() - days * 86_400_000);
	const h = process.argv.indexOf('--hourly');
	if (h > 0) {
		process.stdout.write(await hourly(token, account, Math.max(1, Math.min(72, Number(process.argv[h + 1]) || 24))));
		return;
	}
	const report = await collect(token, account, start, end);
	process.stdout.write(render(report));
	if (process.argv.includes('--json')) {
		const { writeFileSync } = await import('node:fs');
		writeFileSync(process.argv[process.argv.indexOf('--json') + 1], JSON.stringify(report));
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((e) => {
		console.error(e instanceof Error ? e.message : e);
		process.exit(1);
	});
}
