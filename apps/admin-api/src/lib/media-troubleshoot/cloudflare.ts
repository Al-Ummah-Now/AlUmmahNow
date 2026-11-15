/**
 * Read-only Cloudflare reads of the transcode troubleshooting panel (videos admin → Delivery), with
 * the admin-set token (token.ts). The approach of scripts/ops/media-diagnostics.ts (#1407):
 *
 * - Containers API: GET /accounts/{id}/containers/applications (our application by exact name),
 *   then …/applications/{appId}/instances: instances in use out of max_instances, health, and each
 *   instance's Durable Object id (a video's instance is named by its video id).
 * - Queues: GET /accounts/{id}/queues (our transcode queue and its DLQ by exact name), then the
 *   GraphQL Analytics queueBacklogAdaptiveGroups of the last minutes for each.
 * - Workers Observability: POST /accounts/{id}/workers/observability/telemetry/query, events view.
 *   The media Worker's lines: $workers.scriptName = its exact name (warn/error kept). The
 *   transcoder container's stdout and exits: $container.applicationId = our application's id
 *   (those events have no level; all are kept).
 *
 * The Cloudflare account is shared: every filter is built here from our own names and ids, never
 * from the browser. The browser may pass only a video or job id (TROUBLESHOOT_FILTER), which is
 * matched on the returned events, and an hour window from a fixed list. Text going back is scrubbed
 * (scrubOpsText: URL query strings, bearer tokens, JWTs, key/secret fields).
 */
import {
  scrubOpsText,
  TROUBLESHOOT_FILTER,
  type TroubleshootApiError,
  type TroubleshootContainerInstance,
  type TroubleshootLogLine,
  type TroubleshootLogs,
  type TroubleshootStatus,
  type TroubleshootTokenCheck,
} from '@al-ummah/shared-types';
import { logger } from '../logger';

export const CF_API = 'https://api.cloudflare.com/client/v4';

export interface MediaNames {
  /** The media Worker (script name) */
  worker: string;
  /** The Transcoder container application */
  application: string;
  queue: string;
  dlq: string;
}

/** Our resource names per environment; null where the panel reads nothing (local, previews). */
export function mediaNames(environment: string | undefined): MediaNames | null {
  if (environment === 'production') return { worker: 'al-ummah-now-media', application: 'al-ummah-now-media-transcoder', queue: 'al-ummah-now-transcode', dlq: 'al-ummah-now-transcode-dlq' };
  if (environment === 'stage') return { worker: 'al-ummah-now-media-stage', application: 'al-ummah-now-media-stage-transcoder-stage', queue: 'al-ummah-now-transcode-stage', dlq: 'al-ummah-now-transcode-dlq-stage' };
  if (environment === 'qa') return { worker: 'al-ummah-now-media-qa', application: 'al-ummah-now-media-qa-transcoder', queue: 'al-ummah-now-transcode-qa', dlq: 'al-ummah-now-transcode-dlq-qa' };
  return null;
}

type Fetch = typeof fetch;

interface Call {
  ok: boolean;
  status: number;
  body: any;
}

export interface CfContext {
  token: string;
  accountId: string;
  fetchImpl?: Fetch;
}

async function cf(ctx: CfContext, path: string, init?: { method: 'POST'; json: unknown }): Promise<Call> {
  const res = await (ctx.fetchImpl ?? fetch)(`${CF_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
    ...(init ? { body: JSON.stringify(init.json) } : {}),
  });
  const body: any = await res.json().catch(() => null);
  return { ok: res.ok && body?.success !== false && !(Array.isArray(body?.errors) && body.errors.length && !body.data && !body.result), status: res.status, body };
}

/** A failed read as a code (the raw response never leaves the server). */
export function apiError(call: Pick<Call, 'status'>): TroubleshootApiError {
  if (call.status === 401 || call.status === 403) return 'forbidden';
  if (call.status === 404) return 'not_found';
  if (call.status === 429) return 'rate_limited';
  return 'unavailable';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** One instance from the Containers API (fields vary between API versions; read defensively). */
export function parseInstance(raw: any): TroubleshootContainerInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id) ?? str(raw.instance_id) ?? str(raw.deployment_id);
  if (!id) return null;
  const stateRaw = raw.state ?? raw.status ?? raw.current_state;
  const state = typeof stateRaw === 'string' ? stateRaw : str(stateRaw?.current) ?? str(stateRaw?.value) ?? str(stateRaw?.state) ?? null;
  const durableObjectId =
    str(raw.durable_object_id) ?? str(raw.durableObjectId) ?? str(raw.durable_object?.id) ?? str(raw.object_id) ?? str(raw.do_id) ??
    // Any 64-hex field is the Durable Object id (the only one the API carries)
    (Object.values(raw).find((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) as string | undefined) ?? null;
  const location = str(raw.location) ?? str(raw.region) ?? str(raw.placement?.location) ?? null;
  const createdAt = str(raw.created_at) ?? str(raw.createdAt) ?? null;
  return { id, state, durableObjectId, location, createdAt };
}

const IDLE = /^(stopped|stopping|inactive|exited|failed|destroyed|terminated)$/i;

/** Instances in use out of max_instances, health, and each instance. */
export async function readContainers(ctx: CfContext, names: MediaNames): Promise<TroubleshootStatus['containers']> {
  const apps = await cf(ctx, `/accounts/${ctx.accountId}/containers/applications`);
  if (!apps.ok) return { ok: false, error: apiError(apps) };
  const list: any[] = Array.isArray(apps.body?.result) ? apps.body.result : [];
  const app = list.find((a) => a?.name === names.application);
  if (!app || typeof app.id !== 'string') return { ok: false, error: 'not_found' };
  const inst = await cf(ctx, `/accounts/${ctx.accountId}/containers/applications/${encodeURIComponent(app.id)}/instances`);
  const rawList: any[] = inst.ok ? (Array.isArray(inst.body?.result) ? inst.body.result : Array.isArray(inst.body?.result?.instances) ? inst.body.result.instances : []) : [];
  const instances = rawList.map(parseInstance).filter((i): i is TroubleshootContainerInstance => i !== null).slice(0, 50);
  const healthRaw = app.health?.instances ?? app.health ?? null;
  const health = healthRaw && typeof healthRaw === 'object'
    ? Object.fromEntries(Object.entries(healthRaw).filter(([, v]) => typeof v === 'number').slice(0, 12)) as Record<string, number>
    : null;
  const inUse = inst.ok ? instances.filter((i) => !i.state || !IDLE.test(i.state)).length : Number(health?.active ?? app.instances ?? 0) || 0;
  const max = Number(app.max_instances);
  return { ok: true, application: names.application, applicationId: app.id, maxInstances: Number.isFinite(max) && max > 0 ? max : null, inUse, instances, health };
}

const BACKLOG_QUERY = `query($a: String!, $q: String!, $s: Time!, $u: Time!) { viewer { accounts(filter: {accountTag: $a}) {
  queueBacklogAdaptiveGroups(limit: 20, filter: {queueId: $q, datetime_geq: $s, datetime_leq: $u}, orderBy: [datetimeMinute_DESC]) {
    dimensions { datetimeMinute } avg { messages } } } } }`;

/** The transcode queue's and its DLQ's backlog (latest minute of the last 15). */
export async function readQueues(ctx: CfContext, names: MediaNames, now = Date.now()): Promise<TroubleshootStatus['queues']> {
  const list = await cf(ctx, `/accounts/${ctx.accountId}/queues?per_page=100`);
  if (!list.ok) return { ok: false, error: apiError(list) };
  const queues: any[] = Array.isArray(list.body?.result) ? list.body.result : [];
  const idOf = (name: string) => str(queues.find((q) => q?.queue_name === name)?.queue_id);
  const backlog = async (name: string): Promise<number | null> => {
    const id = idOf(name);
    if (!id) return null;
    const r = await cf(ctx, '/graphql', {
      method: 'POST',
      json: { query: BACKLOG_QUERY, variables: { a: ctx.accountId, q: id, s: new Date(now - 15 * 60_000).toISOString(), u: new Date(now).toISOString() } },
    });
    const rows = r.body?.data?.viewer?.accounts?.[0]?.queueBacklogAdaptiveGroups;
    if (!Array.isArray(rows)) return null;
    // No row in the window: nothing waited
    return rows.length ? Math.round(Number(rows[0]?.avg?.messages) || 0) : 0;
  };
  const [q, d] = await Promise.all([backlog(names.queue), backlog(names.dlq)]);
  return { ok: true, queue: { name: names.queue, backlog: q }, dlq: { name: names.dlq, backlog: d } };
}

const DETAIL_KEYS = ['videoId', 'jobId', 'attempt', 'attempts', 'delaySeconds', 'reason', 'stage', 'exitCode', 'stopReason', 'error', 'status'];

/** One Observability event → a log line (scrubbed). */
export function toLogLine(e: any, source: 'worker' | 'container'): TroubleshootLogLine | null {
  if (!e || typeof e !== 'object') return null;
  const ts = Number(e.timestamp ?? e.$metadata?.timestamp ?? 0);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const level = str(e.$metadata?.level) ?? str(e.source?.level) ?? null;
  const src = typeof e.source === 'object' && e.source ? e.source : null;
  const message = str(e.$metadata?.message) ?? str(src?.msg) ?? str(src?.message) ?? (typeof e.source === 'string' ? e.source : null) ?? '';
  const parts: string[] = [];
  if (src) for (const k of DETAIL_KEYS) if (src[k] !== undefined && src[k] !== null && src[k] !== '') parts.push(`${k}=${typeof src[k] === 'object' ? JSON.stringify(src[k]) : String(src[k])}`);
  if (source === 'container' && e.$container) {
    const c = e.$container;
    for (const [k, v] of [['instance', c.instanceId ?? c.placementId], ['exit', c.exitCode], ['v', c.version]] as const) if (v !== undefined && v !== null) parts.push(`${k}=${String(v)}`);
  }
  return {
    at: new Date(ts).toISOString(),
    source,
    level,
    message: scrubOpsText(String(message)).slice(0, 500),
    detail: parts.length ? scrubOpsText(parts.join(' ')).slice(0, 500) : null,
  };
}

async function query(ctx: CfContext, key: string, value: string, from: number, to: number, workers: boolean): Promise<{ ok: true; events: any[] } | { ok: false; error: TroubleshootApiError }> {
  const r = await cf(ctx, `/accounts/${ctx.accountId}/workers/observability/telemetry/query`, {
    method: 'POST',
    json: {
      queryId: `admin-transcode-troubleshoot-${workers ? 'worker' : 'container'}`,
      timeframe: { from, to },
      view: 'events',
      limit: 200,
      parameters: { datasets: workers ? ['cloudflare-workers'] : [], filters: [{ key, operation: 'eq', type: 'string', value }], filterCombination: 'and' },
    },
  });
  if (!r.ok) return { ok: false, error: apiError(r) };
  const events = r.body?.result?.events?.events;
  return { ok: true, events: Array.isArray(events) ? events : [] };
}

export const LOG_LIMIT = 200;
const errorOf = (r: unknown): TroubleshootApiError => (r as { error?: TroubleshootApiError } | null)?.error ?? 'unavailable';

/**
 * Recent warn/error lines of the media Worker and every line of the transcoder container, newest
 * first, optionally only those that name `filter` (a video or job id).
 */
export async function readLogs(
  ctx: CfContext,
  names: MediaNames,
  applicationId: string | null,
  opts: { hours: number; filter?: string | null; source?: 'all' | 'worker' | 'container' },
  now = Date.now(),
): Promise<Pick<TroubleshootLogs, 'lines' | 'sources'>> {
  const filter = opts.filter && TROUBLESHOOT_FILTER.test(opts.filter) ? opts.filter : null;
  const from = now - opts.hours * 3600_000;
  const wantWorker = opts.source !== 'container';
  const wantContainer = opts.source !== 'worker';
  const [w, c] = await Promise.all([
    wantWorker ? query(ctx, '$workers.scriptName', names.worker, from, now, true) : null,
    wantContainer && applicationId ? query(ctx, '$container.applicationId', applicationId, from, now, false) : null,
  ]);
  const matches = (e: unknown) => !filter || JSON.stringify(e).includes(filter);
  const lines: TroubleshootLogLine[] = [];
  if (w?.ok) for (const e of w.events) if (matches(e)) {
    const line = toLogLine(e, 'worker');
    // These Workers log warn and error only; invocation events and anything else are left out
    if (line && line.level && /warn|error/i.test(line.level)) lines.push(line);
  }
  if (c?.ok) for (const e of c.events) if (matches(e)) {
    const line = toLogLine(e, 'container');
    if (line) lines.push(line);
  }
  lines.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    lines: lines.slice(0, LOG_LIMIT),
    sources: {
      worker: !wantWorker ? 'skipped' : w?.ok ? 'ok' : errorOf(w),
      container: !wantContainer ? 'skipped' : !applicationId ? 'not_found' : c?.ok ? 'ok' : errorOf(c),
    },
  };
}

/** What the token can read: each permission the panel needs, probed with one read-only call. */
export async function testToken(ctx: CfContext, names: MediaNames | null, now = Date.now()): Promise<{ ok: boolean; checks: { name: TroubleshootTokenCheck; ok: boolean }[] }> {
  const probe = async (fn: () => Promise<Call>) => {
    try {
      return (await fn()).ok;
    } catch {
      return false;
    }
  };
  const worker = names?.worker ?? 'al-ummah-now-media';
  const [observability, containers, queues, analytics] = await Promise.all([
    probe(() => cf(ctx, `/accounts/${ctx.accountId}/workers/observability/telemetry/query`, {
      method: 'POST',
      json: { queryId: 'admin-transcode-troubleshoot-test', timeframe: { from: now - 600_000, to: now }, view: 'events', limit: 1, parameters: { datasets: ['cloudflare-workers'], filters: [{ key: '$workers.scriptName', operation: 'eq', type: 'string', value: worker }], filterCombination: 'and' } },
    })),
    probe(() => cf(ctx, `/accounts/${ctx.accountId}/containers/applications`)),
    probe(() => cf(ctx, `/accounts/${ctx.accountId}/queues?per_page=1`)),
    probe(async () => {
      const r = await cf(ctx, '/graphql', {
        method: 'POST',
        json: {
          query: 'query($a: String!, $s: Time!) { viewer { accounts(filter: {accountTag: $a}) { workersInvocationsAdaptive(limit: 1, filter: {datetime_geq: $s}) { sum { requests } } } } }',
          variables: { a: ctx.accountId, s: new Date(now - 600_000).toISOString() },
        },
      });
      return { ...r, ok: r.ok && !!r.body?.data?.viewer && !(r.body?.errors?.length) };
    }),
  ]);
  const checks = [
    { name: 'observability' as const, ok: observability },
    { name: 'containers' as const, ok: containers },
    { name: 'queues' as const, ok: queues },
    { name: 'analytics' as const, ok: analytics },
  ];
  if (!checks.every((c) => c.ok)) logger.warn('[MediaTroubleshoot] Token test: missing access', { missing: checks.filter((c) => !c.ok).map((c) => c.name) });
  return { ok: checks.every((c) => c.ok), checks };
}
