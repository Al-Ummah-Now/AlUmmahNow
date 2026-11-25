/**
 * /api/media/troubleshoot/* — R2 transcode troubleshooting (videos admin → Delivery). Owner,
 * 2026-11-14: "why the logs are not on admin to troubleshoot?". Mounted inside media.router, so
 * every route needs media:manage; setting, testing or removing the token needs a super admin.
 *
 *   GET    /?video=               { jobs, status, token }: api-videos' per-job view, merged with the
 *                                 container instances, and the live container / queue status
 *   GET    /logs?q=&hours=&source=   recent media Worker warn/error and transcoder container lines
 *   POST   /jobs/:videoId/retry-now  queued admin job (audited, key media:video:<id>)
 *   POST   /jobs/:videoId/cancel     queued admin job (audited, key media:video:<id>)
 *   GET    /token                 { token } (never the value)
 *   PUT    /token { token }       super admin: seal, test, store; audited by last 4
 *   POST   /token/test            super admin: test the stored token again; audited
 *   DELETE /token                 super admin: remove; audited
 *
 * No token set: the jobs still come from our own records, and status/logs say "token missing".
 * Cloudflare calls per panel refresh (every 30 s while the page is open and visible): containers
 * 2 + queues 3 (list + 2 GraphQL); cached 20 s per isolate. Logs: 2 Observability queries, only
 * when asked for.
 */
import { Hono, type Context } from 'hono';
import { TROUBLESHOOT_FILTER, TROUBLESHOOT_LOG_HOURS, type TroubleshootJobs, type TroubleshootLogs, type TroubleshootStatus } from '@al-ummah/shared-types';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { callVideosInternal, type ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { mediaNames, readContainers, readLogs, readQueues, testToken, type CfContext } from '../lib/media-troubleshoot/cloudflare';
import { readToken, removeToken, saveToken, storeTest, tokenProblem, TokenError } from '../lib/media-troubleshoot/token';
import { withoutHiddenVideos } from '../lib/moderation/takedown';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';
import { auditOriginJson } from '../lib/request-origin';

type Env = { Bindings: AdminBindings & ProcessingClientEnv & { CLOUDFLARE_ACCOUNT_ID?: string }; Variables: { auth?: AuthContext } };
type C = Context<Env>;

/** Same key as media.router's per-video audit (MEDIA_VIDEO_AUDIT_PREFIX); not imported, media.router mounts this file. */
const MEDIA_VIDEO_AUDIT_PREFIX = 'media:video:';
const VIDEO_ID = /^[A-Za-z0-9-]{8,64}$/;
export const STATUS_CACHE_MS = 20_000;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const isSuperAdmin = (c: C) => hasPermission(normalizeRoles(c.get('auth')?.roles), 'ops:manage');
const bad = (c: C, code: string, error: string) => c.json({ success: false, code, error }, 400);

/** Overridable in tests. */
export const deps = { fetch: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch };

async function cfContext(c: C): Promise<{ ctx: CfContext | null; tokenState: TroubleshootStatus['token'] }> {
  const { view, token } = await readToken(c.env.REPORTS_DB as never, c.env.INTERNAL_API_KEY as never);
  if (!view.set) return { ctx: null, tokenState: 'missing' };
  if (!token || !c.env.CLOUDFLARE_ACCOUNT_ID) return { ctx: null, tokenState: 'unreadable' };
  return { ctx: { token, accountId: c.env.CLOUDFLARE_ACCOUNT_ID, fetchImpl: deps.fetch }, tokenState: 'ok' };
}

let statusCache: { key: string; at: number; value: Pick<TroubleshootStatus, 'containers' | 'queues'> } | null = null;
export const clearStatusCache = () => {
  statusCache = null;
};

async function cloudflareStatus(c: C, ctx: CfContext | null): Promise<Pick<TroubleshootStatus, 'containers' | 'queues'>> {
  const names = mediaNames(c.env.ENVIRONMENT);
  if (!ctx || !names) return { containers: null, queues: null };
  const key = `${c.env.ENVIRONMENT}:${ctx.token.slice(-6)}`;
  if (statusCache && statusCache.key === key && Date.now() - statusCache.at < STATUS_CACHE_MS) return statusCache.value;
  const [containers, queues] = await Promise.all([
    readContainers(ctx, names).catch((error) => {
      logger.warn('[MediaTroubleshoot] Containers read failed', { error: error instanceof Error ? error.message : String(error) });
      return { ok: false as const, error: 'unavailable' as const };
    }),
    readQueues(ctx, names).catch((error) => {
      logger.warn('[MediaTroubleshoot] Queues read failed', { error: error instanceof Error ? error.message : String(error) });
      return { ok: false as const, error: 'unavailable' as const };
    }),
  ]);
  const value = { containers, queues };
  statusCache = { key, at: Date.now(), value };
  return value;
}

/** Puts each instance's state on the job whose transcoder it is (Durable Object id). Pure. */
export function mergeInstances(jobs: TroubleshootJobs, containers: TroubleshootStatus['containers']): TroubleshootJobs {
  if (!containers || !containers.ok) return jobs;
  const byDo = new Map(containers.instances.filter((i) => i.durableObjectId).map((i) => [i.durableObjectId!, i]));
  return {
    ...jobs,
    items: jobs.items.map((j) => {
      const inst = j.instance?.durableObjectId ? byDo.get(j.instance.durableObjectId) : undefined;
      return inst && j.instance ? { ...j, instance: { ...j.instance, state: inst.state ?? 'unknown' } } : j;
    }),
  };
}

app.get('/', async (c) => {
  // The video a link names: its finished job too, however old
  const video = VIDEO_ID.test(c.req.query('video') ?? '') ? c.req.query('video') : undefined;
  const [jobsResult, liveResult, cf] = await Promise.allSettled([
    // Only of the videos the reader's lists show
    callVideosInternal<TroubleshootJobs>(c.env, '/internal/media/troubleshoot', { query: { video } }).then(async (jobs) => ({ ...jobs, items: await withoutHiddenVideos(c.env.REPORTS_DB, c.get('auth')?.roles, jobs.items ?? [], (j) => j.videoId) })),
    callVideosInternal<{ live: { queued: number; oldestQueuedAt: string | null; oldestQueuedSeconds: number | null } }>(c.env, '/internal/media/summary', { query: { only: 'live' } }),
    cfContext(c),
  ]);
  const { ctx, tokenState } = cf.status === 'fulfilled' ? cf.value : { ctx: null, tokenState: 'missing' as const };
  const { containers, queues } = await cloudflareStatus(c, ctx);
  const jobs = jobsResult.status === 'fulfilled' ? mergeInstances(jobsResult.value, containers) : null;
  if (jobsResult.status === 'rejected') logger.warn('[MediaTroubleshoot] Jobs unavailable', { error: String(jobsResult.reason) });
  const live = liveResult.status === 'fulfilled' ? liveResult.value.live : null;
  const status: TroubleshootStatus = {
    at: new Date().toISOString(),
    token: tokenState,
    containers,
    queues,
    waiting: live ? { queued: live.queued, oldestQueuedAt: live.oldestQueuedAt, oldestQueuedSeconds: live.oldestQueuedSeconds } : null,
  };
  const token = (await readToken(c.env.REPORTS_DB as never, c.env.INTERNAL_API_KEY as never)).view;
  return c.json({ success: true, result: { jobs, status, token } });
});

app.get('/logs', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q && !TROUBLESHOOT_FILTER.test(q)) return bad(c, 'bad_filter', 'Filter by a video id or a job id');
  const hours = Number(c.req.query('hours') ?? '6');
  if (!(TROUBLESHOOT_LOG_HOURS as readonly number[]).includes(hours)) return bad(c, 'bad_hours', `hours must be one of ${TROUBLESHOOT_LOG_HOURS.join(', ')}`);
  const sourceParam = c.req.query('source') ?? 'all';
  if (!['all', 'worker', 'container'].includes(sourceParam)) return bad(c, 'bad_source', 'source must be all, worker or container');
  const source = sourceParam as 'all' | 'worker' | 'container';
  const { ctx, tokenState } = await cfContext(c);
  const names = mediaNames(c.env.ENVIRONMENT);
  const base = { at: new Date().toISOString(), token: tokenState, hours } as const;
  if (!ctx || !names) {
    const out: TroubleshootLogs = { ...base, lines: [], sources: { worker: 'skipped', container: 'skipped' } };
    return c.json({ success: true, result: out });
  }
  const { containers } = await cloudflareStatus(c, ctx);
  const applicationId = containers && containers.ok ? containers.applicationId : null;
  const logs = await readLogs(ctx, names, applicationId, { hours, filter: q || null, source });
  const out: TroubleshootLogs = { ...base, ...logs };
  return c.json({ success: true, result: out });
});

/** Retry now / Cancel: the audit row first (dropped if api-videos refuses), then a queued admin job. */
async function action(c: C, kind: 'retry-now' | 'cancel') {
  const videoId = c.req.param('videoId') ?? '';
  if (!VIDEO_ID.test(videoId)) return bad(c, 'bad_request', 'bad video id');
  const db = c.env.REPORTS_DB;
  const auditId = crypto.randomUUID();
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(auditId, `${MEDIA_VIDEO_AUDIT_PREFIX}${videoId}`, null, JSON.stringify({ action: kind === 'cancel' ? 'transcode_cancel' : 'transcode_retry_now' }), actorOf(c), new Date().toISOString(), auditOriginJson())
    .run();
  try {
    const result = await callVideosInternal<{ job: unknown }>(c.env, '/internal/media/troubleshoot/actions', { method: 'POST', json: { action: kind, videoId, actorId: actorOf(c) } });
    logger.info('[MediaTroubleshoot] Action queued', { action: kind, videoId, actorId: actorOf(c) });
    return c.json({ success: true, result }, 202);
  } catch (error) {
    await db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(auditId).run().catch(() => undefined);
    throw error;
  }
}

app.post('/jobs/:videoId/retry-now', (c) => action(c, 'retry-now'));
app.post('/jobs/:videoId/cancel', (c) => action(c, 'cancel'));

app.get('/token', async (c) => c.json({ success: true, result: { token: (await readToken(c.env.REPORTS_DB as never, c.env.INTERNAL_API_KEY as never)).view } }));

const superOnly = (c: C) => c.json({ success: false, code: 'forbidden', error: 'Only a super admin can change the Cloudflare token' }, 403);

app.put('/token', async (c) => {
  if (!isSuperAdmin(c)) return superOnly(c);
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
  const problem = tokenProblem(body?.token);
  if (problem) return bad(c, problem, 'That does not look like a Cloudflare API token');
  const value = String(body!.token).trim();
  if (!c.env.CLOUDFLARE_ACCOUNT_ID) return c.json({ success: false, code: 'no_account', error: 'CLOUDFLARE_ACCOUNT_ID is not set' }, 500);
  const test = await testToken({ token: value, accountId: c.env.CLOUDFLARE_ACCOUNT_ID, fetchImpl: deps.fetch }, mediaNames(c.env.ENVIRONMENT));
  try {
    const view = await saveToken(c.env.REPORTS_DB as never, c.env.INTERNAL_API_KEY as never, value, actorOf(c), test, new Date(), c.get('auth')?.email || actorOf(c));
    clearStatusCache();
    logger.info('[MediaTroubleshoot] Token set', { actorId: actorOf(c), ok: test.ok });
    return c.json({ success: true, result: { token: view, test } });
  } catch (error) {
    if (error instanceof TokenError) return c.json({ success: false, code: 'no_key', error: error.message }, 500);
    throw error;
  }
});

app.post('/token/test', async (c) => {
  if (!isSuperAdmin(c)) return superOnly(c);
  const { ctx, tokenState } = await cfContext(c);
  if (!ctx) return c.json({ success: false, code: tokenState === 'unreadable' ? 'unreadable' : 'missing', error: 'No readable token is set' }, 409);
  const test = await testToken(ctx, mediaNames(c.env.ENVIRONMENT));
  await storeTest(c.env.REPORTS_DB as never, actorOf(c), test);
  clearStatusCache();
  return c.json({ success: true, result: { token: (await readToken(c.env.REPORTS_DB as never, c.env.INTERNAL_API_KEY as never)).view, test } });
});

app.delete('/token', async (c) => {
  if (!isSuperAdmin(c)) return superOnly(c);
  const removed = await removeToken(c.env.REPORTS_DB as never, actorOf(c));
  clearStatusCache();
  return c.json({ success: true, result: { removed } });
});

export default app;
