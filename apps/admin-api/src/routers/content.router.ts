/**
 * /api/content/* — platform content management (channels, videos, comments,
 * playlists, community posts and videos users).
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts), so every caller is a
 * super admin, admin or moderator. Reads are open to all three; each change
 * needs its content permission (shared-types ROLE_CONTENT_PERMISSIONS: no new
 * roles, moderators read only, only super admins transfer channels).
 *
 * Every change writes its audit row to site_settings_log first and drops it
 * again if api-videos refuses the change, so no change happens unaudited. The
 * data itself lives in api-videos, reached over the VIDEOS service binding.
 * Users here are videos users (api-videos profiles); nothing calls Auth.
 */
import { Hono, type Context } from 'hono';
import {
  ADMIN_DELETION_KINDS,
  ADMIN_JOB_PERMISSIONS,
  type AdminDeletionKind,
  type AdminDeletionPage,
  contentPermissionsFor,
  hasContentPermission,
  type AdminChannelDetail,
  type AdminChannelRow,
  type AdminJob,
  type AdminContentPermission,
  type AdminPage,
  type AdminUserDetail,
  type AdminVideoDetail,
  type AdminVideoRow,
  type LegacyRestorePlan,
  MAX_BULK_CREATOR_TIER,
  creatorTierOrigin,
  type CreatorTierAssignment,
  type CreatorTierBulkResult,
  cleanTrashReason,
} from '@al-ummah/shared-types';
import { callVideos, VideosError, type VideosCall, type VideosClientEnv } from '../lib/content/videosClient';
import { dropAudit, readAudit, writeAudit, type AuditAction, type ContentKind } from '../lib/content/audit';
import { openReportCounts, recentReports, reportedIds, type ReportEntity } from '../lib/content/reports';
import { logger } from '../lib/logger';
import { inviteStatusByUser } from '../lib/invites';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

const auth = (c: C) => c.get('auth');
const actorOf = (c: C) => auth(c)?.userId ?? 'unknown';

class Forbidden extends Error {
  constructor(readonly permission: AdminContentPermission) {
    super(`The ${permission} permission is required`);
  }
}

function need(c: C, permission: AdminContentPermission) {
  if (!hasContentPermission(auth(c)?.roles, permission)) throw new Forbidden(permission);
}

app.onError((error, c) => {
  if (error instanceof Forbidden) {
    logger.warn('[Content] Permission denied', { userId: actorOf(c as C), permission: error.permission, path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: error.message }, 403);
  }
  if (error instanceof VideosError) {
    return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  }
  logger.error('[Content] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

const ok = (c: C, result: unknown) => c.json({ success: true, result });
const videos = <T>(c: C, path: string, call: VideosCall = {}) => callVideos<T>(c.env, path, { actorId: actorOf(c), ...call });
const body = async (c: C) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
/** The optional reason sent with a delete (shown in Recently deleted). */
const reasonOf = async (c: C) => {
  const reason = (await body(c)).reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 1000) : undefined;
};
const isDeletionKind = (kind: string): kind is AdminDeletionKind => (ADMIN_DELETION_KINDS as readonly string[]).includes(kind);

/**
 * Audits then performs a change. The audit row goes in first and is removed
 * again when the change fails, so the log never misses a change and never
 * records one that did not happen.
 */
async function audited<T>(c: C, entry: Omit<AuditAction, 'actorId'>, run: () => Promise<T>): Promise<T> {
  const db = c.env.REPORTS_DB;
  const auditId = await writeAudit(db, { ...entry, actorId: actorOf(c) });
  try {
    const result = await run();
    logger.info('[Content] Action', { kind: entry.kind, id: entry.id, action: entry.action, actorId: actorOf(c) });
    return result;
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[Content] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
}

/** The previous values of the fields an edit changes, for the audit row. */
function previousOf(current: Record<string, unknown>, edit: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(edit).map((k) => [k, current[k] ?? null]));
}

/** "has reports" filter: turns `reported=yes` into the ids of reported items (null = nothing reported). */
async function withReportedIds(c: C, type: ReportEntity, query: Record<string, string>): Promise<Record<string, string> | null> {
  const { reported, ...rest } = query;
  if (reported !== 'yes') return rest;
  const ids = await reportedIds(c.env.REPORTS_DB, type);
  if (ids.length === 0) return null;
  return { ...rest, ids: ids.join(',') };
}

const emptyPage = (query: Record<string, string>): AdminPage<never> => ({
  items: [],
  total: 0,
  page: Number(query.page ?? 1),
  pageSize: Number(query.pageSize ?? 20),
  indexComplete: true,
});

async function withReportCounts<T extends { id: string; openReports?: number }>(c: C, type: ReportEntity, page: AdminPage<T>): Promise<AdminPage<T>> {
  const counts = await openReportCounts(c.env.REPORTS_DB, type, page.items.map((i) => i.id));
  return { ...page, items: page.items.map((i) => ({ ...i, openReports: counts.get(i.id) ?? 0 })) };
}

/**
 * The item's latest admin jobs (heavy actions run as queued jobs in api-videos),
 * so its page shows "running" or "failed — Retry". A failure to read them is
 * logged and shown as unknown (null), never as "no jobs".
 */
async function jobsFor(c: C, targetKind: AdminJob['targetKind'], targetId: string): Promise<AdminJob[] | null> {
  try {
    return (await videos<{ items: AdminJob[] }>(c, '/jobs', { query: { targetKind, targetId, limit: '5' } })).items;
  } catch (error) {
    logger.warn('[Content] Could not read the item\'s jobs', { targetKind, targetId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Who may do what (admin-web shows only the controls a role may use)
// ---------------------------------------------------------------------------

app.get('/permissions', (c) => ok(c, { permissions: contentPermissionsFor(auth(c)?.roles) }));

app.get('/audit', async (c) => {
  const kind = c.req.query('kind') as ContentKind | undefined;
  const id = c.req.query('id');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100);
  return ok(c, { entries: await readAudit(c.env.REPORTS_DB, { kind, id, limit }) });
});

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

app.get('/channels', async (c) => {
  const query = await withReportedIds(c, 'channel', c.req.query());
  if (!query) return ok(c, emptyPage(c.req.query()));
  return ok(c, await withReportCounts(c, 'channel', await videos<AdminPage<AdminChannelRow>>(c, '/channels', { query })));
});

app.get('/channels/:id', async (c) => {
  const id = c.req.param('id');
  const channel = await videos<AdminChannelDetail>(c, `/channels/${encodeURIComponent(id)}`);
  const [counts, reports, audit, jobs] = await Promise.all([
    openReportCounts(c.env.REPORTS_DB, 'channel', [id]),
    recentReports(c.env.REPORTS_DB, [{ type: 'channel', ids: [id] }]),
    readAudit(c.env.REPORTS_DB, { kind: 'channel', id, limit: 20 }),
    jobsFor(c, 'channel', id),
  ]);
  return ok(c, { ...channel, openReports: counts.get(id) ?? 0, reports, audit, jobs });
});

app.patch('/channels/:id', async (c) => {
  need(c, 'channels:manage');
  const id = c.req.param('id');
  const edit = await body(c);
  const current = await videos<AdminChannelDetail>(c, `/channels/${encodeURIComponent(id)}`);
  return ok(c, await audited(c, { kind: 'channel', id, action: 'edit', details: edit, previous: previousOf(current as never, edit) }, () =>
    videos(c, `/channels/${encodeURIComponent(id)}`, { method: 'PATCH', json: edit })));
});

app.post('/channels/:id/images/:kind', async (c) => {
  need(c, 'channels:manage');
  const id = c.req.param('id');
  const kind = c.req.param('kind');
  const form = await c.req.formData();
  return ok(c, await audited(c, { kind: 'channel', id, action: `image:${kind}` }, () =>
    videos(c, `/channels/${encodeURIComponent(id)}/images/${encodeURIComponent(kind)}`, { method: 'POST', form })));
});

app.post('/channels/:id/suspend', async (c) => {
  need(c, 'channels:manage');
  const id = c.req.param('id');
  const { reason } = await body(c);
  return ok(c, await audited(c, { kind: 'channel', id, action: 'suspend', details: { reason: reason ?? null } }, () =>
    videos(c, `/channels/${encodeURIComponent(id)}/suspend`, { method: 'POST', json: { reason } })));
});

app.post('/channels/:id/unsuspend', async (c) => {
  need(c, 'channels:manage');
  const id = c.req.param('id');
  return ok(c, await audited(c, { kind: 'channel', id, action: 'unsuspend' }, () =>
    videos(c, `/channels/${encodeURIComponent(id)}/unsuspend`, { method: 'POST' })));
});

app.post('/channels/:id/transfer', async (c) => {
  need(c, 'channels:transfer');
  const id = c.req.param('id');
  const raw = (await body(c)).newOwnerId;
  const newOwnerId = typeof raw === 'string' ? raw.trim() : '';
  if (!newOwnerId) return c.json({ success: false, code: 'invalid_new_owner', error: 'newOwnerId (a user id) is required' }, 400);
  const current = await videos<AdminChannelDetail>(c, `/channels/${encodeURIComponent(id)}`);
  return ok(c, await audited(c, { kind: 'channel', id, action: 'transfer', details: { newOwnerId }, previous: { ownerId: current.ownerId } }, () =>
    videos(c, `/channels/${encodeURIComponent(id)}/transfer`, { method: 'POST', json: { newOwnerId } })));
});

app.delete('/channels/:id', async (c) => {
  need(c, 'content:delete');
  const id = c.req.param('id');
  const reason = await reasonOf(c);
  return ok(c, await audited(c, { kind: 'channel', id, action: 'delete', details: { soft: true, ...(reason ? { reason } : {}) } }, () =>
    videos(c, `/channels/${encodeURIComponent(id)}`, { method: 'DELETE', json: { reason } })));
});

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

app.get('/videos', async (c) => {
  const query = await withReportedIds(c, 'video', c.req.query());
  if (!query) return ok(c, emptyPage(c.req.query()));
  return ok(c, await withReportCounts(c, 'video', await videos<AdminPage<AdminVideoRow>>(c, '/videos', { query })));
});

app.get('/videos/:id', async (c) => {
  const id = c.req.param('id');
  const video = await videos<AdminVideoDetail>(c, `/videos/${encodeURIComponent(id)}`);
  const [counts, reports, audit, jobs] = await Promise.all([
    openReportCounts(c.env.REPORTS_DB, 'video', [id]),
    recentReports(c.env.REPORTS_DB, [{ type: 'video', ids: [id] }]),
    readAudit(c.env.REPORTS_DB, { kind: 'video', id, limit: 20 }),
    jobsFor(c, 'video', id),
  ]);
  return ok(c, { ...video, openReports: counts.get(id) ?? 0, reports, audit, jobs });
});

app.patch('/videos/:id', async (c) => {
  need(c, 'videos:manage');
  const id = c.req.param('id');
  const edit = await body(c);
  const current = await videos<AdminVideoDetail>(c, `/videos/${encodeURIComponent(id)}`);
  return ok(c, await audited(c, { kind: 'video', id, action: 'edit', details: edit, previous: previousOf(current as never, edit) }, () =>
    videos(c, `/videos/${encodeURIComponent(id)}`, { method: 'PATCH', json: edit })));
});

app.post('/videos/:id/thumbnail', async (c) => {
  need(c, 'videos:manage');
  const id = c.req.param('id');
  const form = await c.req.formData();
  return ok(c, await audited(c, { kind: 'video', id, action: 'thumbnail' }, () =>
    videos(c, `/videos/${encodeURIComponent(id)}/thumbnail`, { method: 'POST', form })));
});

app.post('/videos/:id/move', async (c) => {
  need(c, 'videos:manage');
  const id = c.req.param('id');
  const { channelId } = await body(c);
  const current = await videos<AdminVideoDetail>(c, `/videos/${encodeURIComponent(id)}`);
  return ok(c, await audited(c, { kind: 'video', id, action: 'move', details: { channelId }, previous: { channelId: current.channelId, ownerId: current.ownerId } }, () =>
    videos(c, `/videos/${encodeURIComponent(id)}/move`, { method: 'POST', json: { channelId } })));
});

for (const action of ['unpublish', 'republish', 'reprocess'] as const) {
  app.post(`/videos/:id/${action}`, async (c) => {
    need(c, 'videos:manage');
    const id = c.req.param('id');
    return ok(c, await audited(c, { kind: 'video', id, action }, () =>
      videos(c, `/videos/${encodeURIComponent(id)}/${action}`, { method: 'POST' })));
  });
}

app.delete('/videos/:id', async (c) => {
  need(c, 'content:delete');
  const id = c.req.param('id');
  const reason = await reasonOf(c);
  return ok(c, await audited(c, { kind: 'video', id, action: 'delete', details: { soft: true, ...(reason ? { reason } : {}) } }, () =>
    videos(c, `/videos/${encodeURIComponent(id)}`, { method: 'DELETE', json: { reason } })));
});

// ---------------------------------------------------------------------------
// Comments, playlists, community posts
// ---------------------------------------------------------------------------

app.get('/comments', async (c) => ok(c, await videos(c, '/comments', { query: c.req.query() })));

app.delete('/videos/:videoId/comments/:commentId', async (c) => {
  need(c, 'content:delete');
  const { videoId, commentId } = c.req.param();
  const reason = await reasonOf(c);
  return ok(c, await audited(c, { kind: 'comment', id: commentId, action: 'delete', details: { videoId, soft: true, ...(reason ? { reason } : {}) } }, () =>
    videos(c, `/videos/${encodeURIComponent(videoId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE', json: { reason } })));
});

app.get('/playlists', async (c) => ok(c, await videos(c, '/playlists', { query: c.req.query() })));

app.delete('/playlists/:id', async (c) => {
  need(c, 'content:delete');
  const id = c.req.param('id');
  const reason = await reasonOf(c);
  return ok(c, await audited(c, { kind: 'playlist', id, action: 'delete', details: { soft: true, ...(reason ? { reason } : {}) } }, () =>
    videos(c, `/playlists/${encodeURIComponent(id)}`, { method: 'DELETE', json: { reason } })));
});

app.get('/posts', async (c) => ok(c, await videos(c, '/posts', { query: c.req.query() })));

app.delete('/posts/:channelId/:postId', async (c) => {
  need(c, 'content:delete');
  const { channelId, postId } = c.req.param();
  const reason = await reasonOf(c);
  return ok(c, await audited(c, { kind: 'post', id: postId, action: 'delete', details: { channelId, soft: true, ...(reason ? { reason } : {}) } }, () =>
    videos(c, `/posts/${encodeURIComponent(channelId)}/${encodeURIComponent(postId)}`, { method: 'DELETE', json: { reason } })));
});

// ---------------------------------------------------------------------------
// Users (videos profiles, keyed by the usr_ id; never the Auth account)
// ---------------------------------------------------------------------------

/** Invited users carry their invite status (the "Invited" badge in lists and pickers). */
async function withInvites<T extends { id: string }>(c: C, items: T[]): Promise<Array<T & { invite: { id: string; status: string } | null }>> {
  const byUser = await inviteStatusByUser(c.env.REPORTS_DB, items.map((i) => i.id)).catch(() => new Map());
  return items.map((i) => ({ ...i, invite: byUser.get(i.id) ?? null }));
}

app.get('/users', async (c) => {
  const page = await videos<AdminPage<{ id: string }>>(c, '/users', { query: c.req.query() });
  return ok(c, Array.isArray(page?.items) ? { ...page, items: await withInvites(c, page.items) } : page);
});

/** The new-owner picker of a channel transfer: a few users by email, name, @handle or id. */
app.get('/users/search', async (c) => {
  need(c, 'channels:transfer');
  const { q = '', exclude, channelId } = c.req.query();
  return ok(c, await videos(c, '/users/search', { query: { q, ...(exclude ? { exclude } : {}), ...(channelId ? { channelId } : {}) } }));
});

app.get('/users/:id', async (c) => {
  const id = c.req.param('id');
  const user = await videos<AdminUserDetail>(c, `/users/${encodeURIComponent(id)}`);
  const owned = await videos<AdminPage<AdminVideoRow>>(c, '/videos', { query: { ownerId: id, pageSize: 100 } });
  const [reports, audit, jobs] = await Promise.all([
    recentReports(c.env.REPORTS_DB, [
      { type: 'channel', ids: user.channels.map((ch) => ch.id) },
      { type: 'video', ids: owned.items.map((v) => v.id) },
    ]),
    readAudit(c.env.REPORTS_DB, { kind: 'user', id, limit: 20 }),
    jobsFor(c, 'user', id),
  ]);
  const [withInvite] = await withInvites(c, [user]);
  return ok(c, { ...withInvite, reports, audit, jobs });
});

app.patch('/users/:id', async (c) => {
  need(c, 'users:manage');
  const id = c.req.param('id');
  const edit = await body(c);
  const current = await videos<AdminUserDetail>(c, `/users/${encodeURIComponent(id)}`);
  return ok(c, await audited(c, { kind: 'user', id, action: 'edit', details: edit, previous: previousOf(current as never, edit) }, () =>
    videos(c, `/users/${encodeURIComponent(id)}`, { method: 'PATCH', json: edit })));
});

app.post('/users/:id/ban', async (c) => {
  need(c, 'users:manage');
  const id = c.req.param('id');
  const { reason } = await body(c);
  return ok(c, await audited(c, { kind: 'user', id, action: 'ban', details: { reason: reason ?? null } }, () =>
    videos(c, `/users/${encodeURIComponent(id)}/ban`, { method: 'POST', json: { reason } })));
});

app.post('/users/:id/unban', async (c) => {
  need(c, 'users:manage');
  const id = c.req.param('id');
  return ok(c, await audited(c, { kind: 'user', id, action: 'unban' }, () =>
    videos(c, `/users/${encodeURIComponent(id)}/unban`, { method: 'POST' })));
});

app.post('/users/:id/delete-data', async (c) => {
  need(c, 'users:manage');
  need(c, 'content:delete');
  const id = c.req.param('id');
  // Soft delete: hidden at once, erased by the 30-day cleanup (api-videos lib/admin/deletions.ts)
  const reason = await reasonOf(c);
  return ok(c, await audited(c, { kind: 'user', id, action: 'delete-data', details: { soft: true, ...(reason ? { reason } : {}) } }, () =>
    videos(c, `/users/${encodeURIComponent(id)}/delete-data`, { method: 'POST', json: { reason } })));
});

// ---------------------------------------------------------------------------
// Recently deleted (soft deletes, api-videos lib/admin/deletions.ts): every
// admin delete above is restorable for 30 days, then the hourly cleanup purges
// it. "Delete permanently now" only queues it for the next cleanup run.
// ---------------------------------------------------------------------------

app.get('/deletions', async (c) => ok(c, await videos<AdminDeletionPage>(c, '/deletions', { query: c.req.query() })));

/** The permission a restore needs on top of content:delete (a user's data also needs users:manage). */
const restoreNeeds = (kind: string) => (kind === 'user' ? (['content:delete', 'users:manage'] as const) : (['content:delete'] as const));

app.post('/deletions/:kind/:id/restore', async (c) => {
  const { kind, id } = c.req.param();
  if (!isDeletionKind(kind)) return c.json({ success: false, code: 'deletion_not_found', error: 'Unknown kind' }, 404);
  for (const permission of restoreNeeds(kind)) need(c, permission);
  return ok(c, await audited(c, { kind, id, action: 'restore' }, () =>
    videos(c, `/deletions/${kind}/${encodeURIComponent(id)}/restore`, { method: 'POST', json: {} })));
});

app.post('/deletions/:kind/:id/purge', async (c) => {
  need(c, 'content:purge');
  const { kind, id } = c.req.param();
  if (!isDeletionKind(kind)) return c.json({ success: false, code: 'deletion_not_found', error: 'Unknown kind' }, 404);
  return ok(c, await audited(c, { kind, id, action: 'purge-request' }, () =>
    videos(c, `/deletions/${kind}/${encodeURIComponent(id)}/purge`, { method: 'POST', json: {} })));
});

// ---------------------------------------------------------------------------
// Restore legacy profile fields: fills empty fields of usr_ profiles from the
// user's pre-SSO profile (api-videos lib/admin/legacy-restore.ts). The dry run
// writes nothing; Run audits every profile it will change (with the planned
// field changes), then queues the job, which backs each profile up first.
// ---------------------------------------------------------------------------

app.get('/legacy-profiles/plan', async (c) => {
  need(c, 'users:manage');
  return ok(c, await videos<LegacyRestorePlan>(c, '/legacy-profiles/plan'));
});

app.post('/legacy-profiles/restore', async (c) => {
  need(c, 'users:manage');
  const input = await body(c);
  const only = Array.isArray(input.ids) ? new Set(input.ids.filter((id): id is string => typeof id === 'string')) : null;
  // The fresh dry run is what gets approved and audited (never a client-supplied change list)
  const plan = await videos<LegacyRestorePlan>(c, '/legacy-profiles/plan');
  const items = plan.items.filter((item) => !only || only.has(item.id));
  if (!items.length) return c.json({ success: false, code: 'nothing_to_restore', error: 'Nothing to restore' }, 409);
  const runId = crypto.randomUUID();
  const db = c.env.REPORTS_DB;
  const auditIds: string[] = [];
  try {
    for (const item of items) {
      auditIds.push(await writeAudit(db, {
        kind: 'user',
        id: item.id,
        action: 'restore-legacy-fields',
        details: { runId, legacyId: item.legacyId, changes: item.changes.map((ch) => ({ field: ch.field, to: ch.to })) },
        previous: Object.fromEntries(item.changes.map((ch) => [ch.field, ch.from ?? null])),
        actorId: actorOf(c),
      }));
    }
    const result = await videos<{ job: AdminJob }>(c, '/legacy-profiles/restore', {
      method: 'POST',
      json: { runId, approved: items.map((item) => ({ id: item.id, legacyId: item.legacyId, fields: item.changes.map((ch) => ch.field) })) },
    });
    logger.info('[Content] Action', { kind: 'user', action: 'restore-legacy-fields', profiles: items.length, jobId: result.job.id, actorId: actorOf(c) });
    return ok(c, result);
  } catch (error) {
    for (const id of auditIds) {
      await dropAudit(db, id).catch((e) => logger.error('[Content] Could not drop the audit row of a failed action', { auditId: id, error: String(e) }));
    }
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Creator tiers (videos-side; never Auth RBAC): who may upload and create
// channels. Reads for every admin; changes need creators:manage (admins and
// super admins) and are audited. A change applies to the user's next request.
// ---------------------------------------------------------------------------

type TierAssignment = Pick<CreatorTierAssignment, 'tierId' | 'source'> & Partial<Pick<CreatorTierAssignment, 'assignedBy' | 'assignedAt'>>;

app.get('/creators', async (c) => ok(c, await videos(c, '/creators', { query: c.req.query() })));
app.get('/creator-tiers', async (c) => ok(c, await videos(c, '/creator-tiers')));

app.get('/creator-tiers/audit', async (c) => {
  const tiers = await videos<{ items: Array<{ id: string }> }>(c, '/creator-tiers');
  const entries = await Promise.all(tiers.items.map((t) => readAudit(c.env.REPORTS_DB, { kind: 'creator-tier', id: t.id, limit: 20 })));
  return ok(c, { items: entries.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50) });
});

app.post('/creator-tiers', async (c) => {
  need(c, 'creators:manage');
  const input = await body(c);
  const id = typeof input.id === 'string' ? input.id : '';
  return ok(c, await audited(c, { kind: 'creator-tier', id, action: 'create', details: input }, () =>
    videos(c, '/creator-tiers', { method: 'POST', json: input })));
});

app.put('/creator-tiers/:id', async (c) => {
  need(c, 'creators:manage');
  const id = c.req.param('id');
  const input = await body(c);
  const current = (await videos<{ items: Array<Record<string, unknown>> }>(c, '/creator-tiers')).items.find((t) => t.id === id);
  return ok(c, await audited(c, { kind: 'creator-tier', id, action: 'edit', details: input, previous: current ? previousOf(current as never, input) : undefined }, () =>
    videos(c, `/creator-tiers/${encodeURIComponent(id)}`, { method: 'PUT', json: input })));
});

/** Soft delete: restorable for 30 days in Recently deleted (/api/trash), then purged by the hourly cleanup. */
app.delete('/creator-tiers/:id', async (c) => {
  need(c, 'creators:manage');
  const id = c.req.param('id');
  const reason = cleanTrashReason((await body(c)).reason);
  return ok(c, await audited(c, { kind: 'creator-tier', id, action: 'delete', details: reason ? { reason } : undefined }, () =>
    videos(c, `/creator-tiers/${encodeURIComponent(id)}`, { method: 'DELETE', json: { reason } })));
});

app.get('/users/:id/creator-tier', async (c) => {
  const id = c.req.param('id');
  const [current, audit] = await Promise.all([
    videos<{ assignment: TierAssignment | null }>(c, `/users/${encodeURIComponent(id)}/creator-tier`),
    readAudit(c.env.REPORTS_DB, { kind: 'user', id, limit: 50 }),
  ]);
  return ok(c, { ...current, audit: audit.filter((e) => e.action === 'creator-tier') });
});

/**
 * A super admin's automatic Unlimited is never changed by mistake: the change
 * needs `confirmSuperAdmin: true` (the admin's explicit second confirmation).
 */
app.put('/users/:id/creator-tier', async (c) => {
  need(c, 'creators:manage');
  const id = c.req.param('id');
  const input = await body(c);
  const tierId = input.tierId === null || input.tierId === '' ? null : String(input.tierId ?? '');
  if (tierId === '') return c.json({ success: false, code: 'invalid_request', error: 'tierId is required (null removes the tier)' }, 400);
  const source = input.source === 'subscription' ? 'subscription' : 'admin';
  const current = await videos<{ assignment: TierAssignment | null }>(c, `/users/${encodeURIComponent(id)}/creator-tier`);
  const superAdmin = creatorTierOrigin(current.assignment as CreatorTierAssignment | null) === 'super_admin';
  if (superAdmin && input.confirmSuperAdmin !== true) {
    logger.warn('[Content] Refused a change to a super admin tier', { userId: id, actorId: actorOf(c) });
    return c.json({ success: false, code: 'super_admin_tier', error: 'This user is a super admin: their Unlimited tier is automatic' }, 409);
  }
  return ok(c, await audited(c, {
    kind: 'user', id, action: 'creator-tier',
    details: { tierId, source, ...(superAdmin ? { overrodeSuperAdmin: true } : {}) },
    previous: { tierId: current.assignment?.tierId ?? null, source: current.assignment?.source ?? null },
  }, () => videos(c, `/users/${encodeURIComponent(id)}/creator-tier`, { method: 'PUT', json: { tierId, source } })));
});

/**
 * One tier (or none) for the selected users. Light work (one D1 batch of at
 * most MAX_BULK_CREATOR_TIER rows), so it runs inline rather than as a queued
 * admin job. Plans first (dry run), audits each user who changes, then
 * applies; a failed apply drops the audit rows again. Super admins are
 * skipped and users already on the tier are left alone, so a retry is safe.
 */
app.post('/creators/tier', async (c) => {
  need(c, 'creators:manage');
  const input = await body(c);
  const userIds = Array.isArray(input.userIds) ? [...new Set(input.userIds.filter((v): v is string => typeof v === 'string' && v.length > 0))] : [];
  const tierId = input.tierId === null ? null : typeof input.tierId === 'string' && input.tierId ? input.tierId : undefined;
  if (!userIds.length || userIds.length > MAX_BULK_CREATOR_TIER || tierId === undefined) {
    return c.json({ success: false, code: 'invalid_request', error: `userIds (1 to ${MAX_BULK_CREATOR_TIER}) and tierId (null removes the tier) are required` }, 400);
  }
  const plan = await videos<CreatorTierBulkResult>(c, '/creators/tier', { method: 'POST', json: { userIds, tierId, dryRun: true } });
  if (!plan.changed.length) return ok(c, plan);
  const db = c.env.REPORTS_DB;
  const runId = crypto.randomUUID();
  const auditIds = new Map<string, string>();
  const drop = (ids: string[]) => Promise.all(ids.map((auditId) => dropAudit(db, auditId).catch((e) => logger.error('[Content] Could not drop the audit row of a failed action', { auditId, error: String(e) }))));
  try {
    for (const change of plan.changed) {
      auditIds.set(change.userId, await writeAudit(db, {
        kind: 'user', id: change.userId, action: 'creator-tier',
        details: { tierId, source: 'admin', bulk: runId },
        previous: { tierId: change.previous?.tierId ?? null, source: change.previous?.source ?? null },
        actorId: actorOf(c),
      }));
    }
    const result = await videos<CreatorTierBulkResult>(c, '/creators/tier', { method: 'POST', json: { userIds: plan.changed.map((ch) => ch.userId), tierId } });
    // Someone else changed a user between the plan and the change: no row for a change that did not happen
    const changed = new Set(result.changed.map((ch) => ch.userId));
    await drop([...auditIds].filter(([userId]) => !changed.has(userId)).map(([, auditId]) => auditId));
    logger.info('[Content] Action', { kind: 'user', action: 'creator-tier-bulk', tierId, users: result.changed.length, runId, actorId: actorOf(c) });
    return ok(c, { ...result, unchanged: [...plan.unchanged, ...result.unchanged], skippedSuperAdmin: [...plan.skippedSuperAdmin, ...result.skippedSuperAdmin] });
  } catch (error) {
    await drop([...auditIds.values()]);
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Admin jobs: heavy actions (deletes, suspend/ban cascades, transfers, moves)
// run from a queue in api-videos. Failed ones flag the admin here, with Retry.
// ---------------------------------------------------------------------------

app.get('/jobs', async (c) => ok(c, await videos(c, '/jobs', { query: c.req.query() })));
app.get('/jobs/counts', async (c) => ok(c, await videos(c, '/jobs/counts')));
app.get('/jobs/:id', async (c) => ok(c, await videos(c, `/jobs/${encodeURIComponent(c.req.param('id'))}`)));

app.post('/jobs/:id/retry', async (c) => {
  const jobId = c.req.param('id');
  const job = await videos<AdminJob>(c, `/jobs/${encodeURIComponent(jobId)}`);
  // Retrying runs the action again: it needs the permissions the action itself needs
  for (const permission of ADMIN_JOB_PERMISSIONS[job.kind] ?? ['content:delete']) need(c, permission);
  return ok(c, await audited(c, { kind: job.targetKind, id: job.targetId, action: 'job-retry', details: { jobId, jobKind: job.kind } }, () =>
    videos(c, `/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' })));
});

export default app;
