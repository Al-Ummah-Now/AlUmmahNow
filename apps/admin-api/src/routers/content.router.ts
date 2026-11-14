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
  isSuperAdmin,
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
  warningEscalation,
  type AccountEmailContact,
  type AccountNoticeRequest,
  type AccountNoticeResult,
  type IssueUserWarningRequest,
  type IssueUserWarningResult,
  type NotificationEmailLocale,
  type UserWarningList,
  cleanLiveRoutingPatch,
  isLiveProvider,
  livePatchPrevious,
  type LiveChannelOverride,
  type LiveProviderId,
  type LiveProviderUsage,
  type LiveRoutingSettings,
} from '@al-ummah/shared-types';
import {
  countWarnings,
  getWarning,
  insertWarning,
  listWarnings,
  markInAppSent,
  newWarningId,
  parseWarningRequest,
  recordWarningEmail,
  toWarning,
  warningCounts,
  WarningInputError,
} from '../lib/content/warnings';
import { enqueueWarningMail, flagWarningMailFailure } from '../lib/warning-mail';
import { callVideos, VideosError, type VideosCall, type VideosClientEnv } from '../lib/content/videosClient';
import { dropAudit, readAudit, setAuditPrevious, writeAudit, type AuditAction, type ContentKind } from '../lib/content/audit';
import { banVideosUser } from '../lib/content/userBan';
import { openReportCounts, recentReports, reportedIds, type ReportEntity } from '../lib/content/reports';
import { logger } from '../lib/logger';
import { inviteStatusByUser, syncInvitesOnRead, type InviteQueueEnv } from '../lib/invites';
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
async function audited<T>(c: C, entry: Omit<AuditAction, 'actorId'>, run: () => Promise<T>, previousFrom?: (result: T) => Record<string, unknown>): Promise<T> {
  const db = c.env.REPORTS_DB;
  const auditId = await writeAudit(db, { ...entry, actorId: actorOf(c) });
  try {
    const result = await run();
    // Only api-videos knows some previous values (a stream's move): record them once it answers
    if (previousFrom) await setAuditPrevious(db, auditId, previousFrom(result)).catch((e) => logger.warn('[Content] Could not record the previous value', { auditId, error: String(e) }));
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
    return (await videos<{ items: AdminJob[] }>(c, '/jobs', { query: { targetKind, targetId, limit: '5' } })).items.map((j) => redactJob(c, j));
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

// Site visits of the videos site (D-SEO-9): landing pages and sources, last ?days= (1-365)
app.get('/analytics/visits', async (c) => ok(c, await videos(c, '/analytics/visits', { query: { days: c.req.query('days') ?? '30' } })));

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

/** Users carry their warning count ("2 warnings" in lists and the report triage); left out when it cannot be read. */
async function withWarningCounts<T extends { id: string }>(c: C, items: T[]): Promise<Array<T & { warningCount?: number }>> {
  try {
    const counts = await warningCounts(c.env.REPORTS_DB, items.map((i) => i.id));
    return items.map((i) => ({ ...i, warningCount: counts.get(i.id) ?? 0 }));
  } catch (error) {
    logger.warn('[Content] Could not read warning counts', { users: items.length, error: error instanceof Error ? error.message : String(error) });
    return items;
  }
}

app.get('/users', async (c) => {
  const page = await videos<AdminPage<{ id: string }>>(c, '/users', { query: c.req.query() });
  return ok(c, Array.isArray(page?.items) ? { ...page, items: await withWarningCounts(c, await withInvites(c, page.items)) } : page);
});

/** The new-owner picker of a channel transfer: a few users by email, name, @handle or id. */
app.get('/users/search', async (c) => {
  need(c, 'channels:transfer');
  const { q = '', exclude, channelId } = c.req.query();
  const found = await videos<{ items: Array<{ id: string }> }>(c, '/users/search', { query: { q, ...(exclude ? { exclude } : {}), ...(channelId ? { channelId } : {}) } });
  // Invited users (not signed in yet) are valid new owners; the picker badges them
  return ok(c, Array.isArray(found?.items) ? { ...found, items: await withInvites(c, found.items) } : found);
});

app.get('/users/:id', async (c) => {
  const id = c.req.param('id');
  const user = await videos<AdminUserDetail>(c, `/users/${encodeURIComponent(id)}`);
  const owned = await videos<AdminPage<AdminVideoRow>>(c, '/videos', { query: { ownerId: id, pageSize: 100 } });
  const [reports, audit, jobs, emailLanguage] = await Promise.all([
    recentReports(c.env.REPORTS_DB, [
      { type: 'channel', ids: user.channels.map((ch) => ch.id) },
      { type: 'video', ids: owned.items.map((v) => v.id) },
    ]),
    readAudit(c.env.REPORTS_DB, { kind: 'user', id, limit: 20 }),
    jobsFor(c, 'user', id),
    savedEmailLanguage(c, id),
  ]);
  const [withInvite] = await withWarningCounts(c, await withInvites(c, [user]));
  // An invited user's page reads the invite's status again (queued; "Signed in" within seconds)
  if (withInvite.invite) await syncInvitesOnRead(c.env as unknown as InviteQueueEnv, [withInvite.invite.id]);
  return ok(c, { ...withInvite, emailLanguage, reports, audit, jobs });
});

// ---------------------------------------------------------------------------
// Warnings (users:warn: moderators, admins, super admins). The record lives
// here (user_warnings); the user is told in-app (api-videos notification
// accountWarning, always on) and by email unless they turned it off.
// ---------------------------------------------------------------------------

/** The issuer's name as their token gives it (name, else email, else id). */
const issuerName = (c: C) => {
  const a = auth(c);
  const name = a?.payload?.name;
  return (typeof name === 'string' && name.trim()) || a?.email || a?.userId || 'unknown';
};

/**
 * The user's saved email language (the Warn dialog preselects it); null when
 * never picked, or when it cannot be read (logged; the dialog then falls back
 * to the admin's UI language).
 */
async function savedEmailLanguage(c: C, userId: string): Promise<NotificationEmailLocale | null> {
  try {
    return (await videos<AccountEmailContact>(c, `/users/${encodeURIComponent(userId)}/account-email`)).savedLocale ?? null;
  } catch (error) {
    if (!(error instanceof VideosError && error.status === 404)) {
      logger.warn('[Content] Could not read the user\'s email language', { userId, error: error instanceof Error ? error.message : String(error) });
    }
    return null;
  }
}

app.get('/users/:id/warnings', async (c) => {
  need(c, 'users:warn');
  const id = c.req.param('id');
  const [list, emailLanguage] = await Promise.all([listWarnings(c.env.REPORTS_DB, id), savedEmailLanguage(c, id)]);
  const result: UserWarningList = { ...list, emailLanguage };
  return ok(c, result);
});

app.post('/users/:id/warnings', async (c) => {
  need(c, 'users:warn');
  const id = c.req.param('id');
  let input: IssueUserWarningRequest;
  try {
    input = parseWarningRequest(await body(c));
  } catch (error) {
    if (error instanceof WarningInputError) return c.json({ success: false, code: error.code, error: error.message }, 400);
    throw error;
  }
  // 404 for someone who is not a videos user (no profile to notify)
  await videos<AccountEmailContact>(c, `/users/${encodeURIComponent(id)}/account-email`);

  const db = c.env.REPORTS_DB;
  const warningId = newWarningId();
  const ordinal = (await countWarnings(db, id)) + 1;
  const row = {
    id: warningId,
    userId: id,
    ...input,
    issuedBy: actorOf(c),
    issuedByName: issuerName(c),
    createdAt: new Date().toISOString(),
  };
  await audited(c, {
    kind: 'user',
    id,
    action: 'warn',
    details: { warningId, reasonCode: input.reasonCode, ordinal, locale: input.locale, ...(input.note ? { note: input.note } : {}), ...(input.reportId ? { reportId: input.reportId } : {}), ...(input.entityKind ? { entityKind: input.entityKind, entityId: input.entityId } : {}) },
  }, () => insertWarning(db, row));
  const count = await countWarnings(db, id);

  // In-app notice: best effort, the warning stands either way (inAppSent shows it)
  try {
    const notice: AccountNoticeRequest = { kind: 'warning', noticeId: warningId, reasonCode: input.reasonCode, count: ordinal };
    const result = await videos<AccountNoticeResult>(c, `/users/${encodeURIComponent(id)}/account-notices`, { method: 'POST', json: notice });
    if (result?.queued) await markInAppSent(db, warningId);
  } catch (error) {
    logger.error('[Content] Warning notice not delivered in-app', { warningId, userId: id, error: error instanceof Error ? error.message : String(error) });
  }

  // Email: queued; the consumer checks the user's preference and language at send time
  await recordWarningEmail(db, warningId, 'queued');
  if (!(await enqueueWarningMail(c.env, warningId))) {
    await recordWarningEmail(db, warningId, 'failed', { error: 'could not queue the email' });
    await flagWarningMailFailure(c.env, warningId, id, 'could not queue the email');
  }

  const stored = await getWarning(db, warningId);
  const { suggestBan } = warningEscalation(count);
  const result: IssueUserWarningResult = { warning: toWarning(stored!, ordinal), count, ordinal, suggestBan };
  return ok(c, result);
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
  // The same path a report's "banned" outcome takes (lib/content/userBan.ts)
  return ok(c, await banVideosUser(c.env, { userId: id, actorId: actorOf(c), reason: typeof reason === 'string' ? reason : null }));
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
// ?counts=0 passes through: the definitions without the (full-table) counts
app.get('/creator-tiers', async (c) => ok(c, await videos(c, '/creator-tiers', { query: c.req.query() })));

app.get('/creator-tiers/audit', async (c) => {
  const tiers = await videos<{ items: Array<{ id: string }> }>(c, '/creator-tiers', { query: { counts: '0' } });
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
  const current = (await videos<{ items: Array<Record<string, unknown>> }>(c, '/creator-tiers', { query: { counts: '0' } })).items.find((t) => t.id === id);
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
 * Caption minutes (AUN-CAPTIONS §6, owner decision 2026-11-14): the user's month
 * (tier minutes + grants) and the admin's grants. Reads for every admin; a
 * grant or a revoke needs creators:manage, a reason, and is audited.
 */
app.get('/users/:id/caption-minutes', async (c) => {
  const id = c.req.param('id');
  const [current, audit] = await Promise.all([
    videos<Record<string, unknown>>(c, `/users/${encodeURIComponent(id)}/caption-minutes`),
    readAudit(c.env.REPORTS_DB, { kind: 'user', id, limit: 50 }),
  ]);
  return ok(c, { ...current, audit: audit.filter((e) => e.action === 'caption-grant' || e.action === 'caption-grant-revoke') });
});

app.post('/users/:id/caption-minutes/grants', async (c) => {
  need(c, 'creators:manage');
  const id = c.req.param('id');
  const input = await body(c);
  const details = { minutes: input.minutes, scope: input.scope, reason: typeof input.reason === 'string' ? input.reason.trim() : input.reason };
  return ok(c, await audited(c, { kind: 'user', id, action: 'caption-grant', details }, () =>
    videos(c, `/users/${encodeURIComponent(id)}/caption-minutes/grants`, { method: 'POST', json: details })));
});

app.post('/users/:id/caption-minutes/grants/:grantId/revoke', async (c) => {
  need(c, 'creators:manage');
  const id = c.req.param('id');
  const grantId = c.req.param('grantId');
  const reason = (await body(c)).reason;
  return ok(c, await audited(c, { kind: 'user', id, action: 'caption-grant-revoke', details: { grantId, reason } }, () =>
    videos(c, `/users/${encodeURIComponent(id)}/caption-minutes/grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST', json: { reason } })));
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

/** A CSAM takedown job names the case and the matched URL: only super admins see its details. */
const CSAM_JOB_KINDS = new Set<string>(['csam.contain']);
function redactJob(c: C, job: AdminJob): AdminJob {
  if (!CSAM_JOB_KINDS.has(job.kind) || isSuperAdmin(c.get('auth')?.roles)) return job;
  return { ...job, params: {}, result: null, lastError: job.lastError ? 'hidden' : null };
}

app.get('/jobs', async (c) => {
  const out = await videos<{ items: AdminJob[] }>(c, '/jobs', { query: c.req.query() });
  return ok(c, Array.isArray(out?.items) ? { ...out, items: out.items.map((j) => redactJob(c, j)) } : out);
});
app.get('/jobs/counts', async (c) => ok(c, await videos(c, '/jobs/counts')));
app.get('/jobs/:id', async (c) => {
  const job = await videos<AdminJob>(c, `/jobs/${encodeURIComponent(c.req.param('id'))}`);
  return ok(c, job?.kind ? redactJob(c, job) : job);
});

app.post('/jobs/:id/retry', async (c) => {
  const jobId = c.req.param('id');
  const job = await videos<AdminJob>(c, `/jobs/${encodeURIComponent(jobId)}`);
  // Retrying runs the action again: it needs the permissions the action itself needs
  if (CSAM_JOB_KINDS.has(job.kind) && !isSuperAdmin(c.get('auth')?.roles)) return c.json({ success: false, code: 'forbidden', error: 'Super admins only' }, 403);
  for (const permission of ADMIN_JOB_PERMISSIONS[job.kind] ?? ['content:delete']) need(c, permission);
  return ok(c, await audited(c, { kind: job.targetKind, id: job.targetId, action: 'job-retry', details: { jobId, jobKind: job.kind } }, () =>
    videos(c, `/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' })));
});

// ---------------------------------------------------------------------------
// Live streaming providers (D3): which provider new live streams go to. Reads
// for every admin; changes need live:manage (admins and super admins) and are
// audited with the values they replace, so the page's Undo and the history
// can put them back. Changes apply to new streams within 15 s (api-videos
// cache) and never cut a session that is live.
// ---------------------------------------------------------------------------

interface LiveSettingsView {
  settings: LiveRoutingSettings;
  usage: Record<LiveProviderId, LiveProviderUsage>;
  overrides: LiveChannelOverride[];
}

const LIVE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const badRequest = (c: C, error: string) => c.json({ success: false, code: 'invalid_request', error }, 400);
const liveNote = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);

app.get('/live/settings', async (c) => ok(c, await videos<LiveSettingsView>(c, '/live/settings')));

app.get('/live/sessions', async (c) => {
  const q = c.req.query();
  const query: Record<string, string> = {};
  if (q.status === 'active' || q.status === 'recent') query.status = q.status;
  if (isLiveProvider(q.provider)) query.provider = q.provider;
  if (q.limit && /^\d{1,3}$/.test(q.limit)) query.limit = q.limit;
  return ok(c, await videos(c, '/live/sessions', { query }));
});

app.get('/live/compare', async (c) => {
  const q = c.req.query();
  const query: Record<string, string> = { tests: q.tests === '1' ? '1' : '0' };
  for (const k of ['from', 'to'] as const) if (q[k] && /^\d{4}-\d{2}-\d{2}$/.test(q[k])) query[k] = q[k];
  return ok(c, await videos(c, '/live/compare', { query }));
});

/** The live streaming changes, newest first (the page's History). */
app.get('/live/audit', async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
  return ok(c, { items: await readAudit(c.env.REPORTS_DB, { live: true, limit }) });
});

/** A partial change (mode, split, a provider's toggles or caps, rates, self-hosted options, QoE rate). */
app.put('/live/settings', async (c) => {
  need(c, 'live:manage');
  const patch = cleanLiveRoutingPatch(await body(c));
  if (!patch) return badRequest(c, 'Nothing to change');
  const current = await videos<LiveSettingsView>(c, '/live/settings');
  return ok(c, await audited(c, { kind: 'live-settings', id: 'routing', action: 'edit', details: patch as Record<string, unknown>, previous: livePatchPrevious(current.settings, patch) as Record<string, unknown> }, () =>
    videos(c, '/live/settings', { method: 'PUT', json: patch })));
});

/** Reset to the shipped defaults (audited with the settings it replaced). */
app.delete('/live/settings', async (c) => {
  need(c, 'live:manage');
  const current = await videos<LiveSettingsView>(c, '/live/settings');
  return ok(c, await audited(c, { kind: 'live-settings', id: 'routing', action: 'reset', previous: current.settings as unknown as Record<string, unknown> }, () =>
    videos(c, '/live/settings', { method: 'DELETE' })));
});

app.put('/live/overrides/:channelId', async (c) => {
  need(c, 'live:manage');
  const channelId = c.req.param('channelId');
  const input = await body(c);
  if (!LIVE_ID.test(channelId) || !isLiveProvider(input.provider)) return badRequest(c, 'A channel and a provider (bunny or selfhosted) are required');
  const note = liveNote(input.note);
  const before = (await videos<LiveSettingsView>(c, '/live/settings')).overrides.find((o) => o.channelId === channelId);
  return ok(c, await audited(c, {
    kind: 'live-override', id: channelId, action: 'set',
    details: { provider: input.provider, note },
    previous: { provider: before?.provider ?? null, note: before?.note ?? null },
  }, () => videos(c, `/live/overrides/${encodeURIComponent(channelId)}`, { method: 'PUT', json: { provider: input.provider, note } })));
});

app.delete('/live/overrides/:channelId', async (c) => {
  need(c, 'live:manage');
  const channelId = c.req.param('channelId');
  if (!LIVE_ID.test(channelId)) return badRequest(c, 'Invalid channel');
  const before = (await videos<LiveSettingsView>(c, '/live/settings')).overrides.find((o) => o.channelId === channelId);
  return ok(c, await audited(c, { kind: 'live-override', id: channelId, action: 'remove', previous: { provider: before?.provider ?? null, note: before?.note ?? null } }, () =>
    videos(c, `/live/overrides/${encodeURIComponent(channelId)}`, { method: 'DELETE' })));
});

/** The stream's next session goes to `provider` (null cancels). The audit row gets the previous move once api-videos reports it. */
app.post('/live/streams/:id/move', async (c) => {
  need(c, 'live:manage');
  const id = c.req.param('id');
  const input = await body(c);
  if (!LIVE_ID.test(id) || !(input.provider === null || isLiveProvider(input.provider))) return badRequest(c, 'provider must be bunny, selfhosted or null');
  return ok(c, await audited(c, { kind: 'live-stream', id, action: 'move', details: { provider: input.provider } },
    () => videos<{ previous: LiveProviderId | null; currentProvider: LiveProviderId | null }>(c, `/live/streams/${encodeURIComponent(id)}/move`, { method: 'POST', json: { provider: input.provider } }),
    (out) => ({ provider: out.previous ?? null })));
});

/** End a stuck session (confirmed in the page). Not undoable: the creator starts a new session. */
app.post('/live/sessions/:id/end', async (c) => {
  need(c, 'live:manage');
  const id = c.req.param('id');
  if (!LIVE_ID.test(id)) return badRequest(c, 'Invalid session');
  return ok(c, await audited(c, { kind: 'live-session', id, action: 'end' }, () =>
    videos(c, `/live/sessions/${encodeURIComponent(id)}/end`, { method: 'POST', json: {} })));
});

export default app;
