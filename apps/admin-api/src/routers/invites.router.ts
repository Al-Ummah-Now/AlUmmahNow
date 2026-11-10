/**
 * /api/invites/* — invite creators (docs/admin/INVITES.md).
 *
 * Behind authMiddleware + adminMiddleware. Reads are open to every admin role;
 * changes need users:manage, plus creators:manage to give a plan,
 * channels:manage to create channels and channels:transfer to hand over
 * existing ones. Each admin may make INVITE_ACTIONS_PER_HOUR invite changes an
 * hour. Every change is audited (admin_audit_log + the user's content audit).
 *
 * The person is a videos user as soon as the invite is made: admin-api mints
 * the user id, api-videos makes the profile, tier and channels under it, and
 * the auth account is created through the queue (lib/invites.ts).
 */
import { Hono, type Context } from 'hono';
import { hasContentPermission, type AdminContentPermission } from '@al-ummah/shared-types';
import { callVideos, VideosError, type VideosCall, type VideosClientEnv } from '../lib/content/videosClient';
import { writeAudit } from '../lib/content/audit';
import { audit } from '../lib/authModeration';
import { logger } from '../lib/logger';
import {
  DEFAULT_INVITE_DAYS,
  isEmailAddress,
  INVITE_ACTIONS_PER_HOUR,
  INVITE_AUTH_ROLES,
  MAX_INVITE_DAYS,
  addChannels,
  enqueue,
  getInvite,
  insertInvite,
  listInvites,
  liveInviteForEmail,
  newInviteId,
  newLinkToken,
  newUserId,
  normalizeEmail,
  recentInviteActions,
  setPendingOp,
  sha256Hex,
  signInUrl,
  toView,
  type InviteChannel,
  type InviteListStatus,
  type InviteOp,
  type InviteQueueEnv,
  type InviteRow,
} from '../lib/invites';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

class HttpError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 429, readonly code: string, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

const auth = (c: C) => c.get('auth');
const actorOf = (c: C) => auth(c)?.userId ?? 'unknown';
const can = (c: C, permission: AdminContentPermission) => hasContentPermission(auth(c)?.roles, permission);
function need(c: C, permission: AdminContentPermission) {
  if (!can(c, permission)) throw new HttpError(403, 'forbidden', `The ${permission} permission is required`);
}
const ok = (c: C, result: unknown, status: 200 | 201 = 200) => c.json({ success: true, result }, status);
const videos = <T>(c: C, path: string, call: VideosCall = {}) => callVideos<T>(c.env, path, { actorId: actorOf(c), ...call });
const body = async (c: C) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const queueEnv = (c: C) => c.env as unknown as InviteQueueEnv;

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ success: false, code: error.code, error: error.message, ...(error.extra ?? {}) }, error.status);
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  logger.error('[Invites] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

/** Rate limit per admin, then both audit logs. */
async function record(c: C, action: string, row: Pick<InviteRow, 'id' | 'user_id'>, details: Record<string, unknown> = {}) {
  const actorId = actorOf(c);
  await audit(c.env.REPORTS_DB, { actorId, actorEmail: auth(c)?.email ?? null, action: `invite.${action}`, targetType: 'user', targetId: row.user_id, metadata: { inviteId: row.id, ...details } });
  await writeAudit(c.env.REPORTS_DB, { kind: 'user', id: row.user_id, action: `invite-${action}`, actorId, details: { inviteId: row.id, ...details } });
}

async function limit(c: C) {
  if ((await recentInviteActions(c.env.REPORTS_DB, actorOf(c))) >= INVITE_ACTIONS_PER_HOUR) {
    throw new HttpError(429, 'rate_limited', `At most ${INVITE_ACTIONS_PER_HOUR} invite changes an hour; try again later`);
  }
}

async function requireInvite(c: C): Promise<InviteRow> {
  const row = await getInvite(c.env.REPORTS_DB, c.req.param('id') ?? '');
  if (!row) throw new HttpError(404, 'not_found', 'Invite not found');
  return row;
}

interface AccountLookup {
  authUser: { id: string; email: string; name: string | null; status: string } | null;
  profile: { id: string; displayName: string | null } | null;
}

/** Who already has this email: an account (offer "assign to existing user" instead) or an open invite. */
async function lookup(c: C, email: string) {
  const [accounts, invite] = await Promise.all([
    videos<AccountLookup>(c, '/accounts', { query: { email } }),
    liveInviteForEmail(c.env.REPORTS_DB, email),
  ]);
  return { ...accounts, invite: invite ? toView(invite) : null };
}

app.get('/', async (c) => {
  const q = c.req.query();
  return ok(c, await listInvites(c.env.REPORTS_DB, { status: q.status as InviteListStatus | undefined, q: q.q, cursor: q.cursor, limit: q.limit ? Number(q.limit) : undefined }));
});

app.get('/lookup', async (c) => {
  const email = normalizeEmail(c.req.query('email') ?? '');
  if (!isEmailAddress(email)) throw new HttpError(400, 'invalid_email', 'A valid email is required');
  return ok(c, await lookup(c, email));
});

app.get('/:id', async (c) => ok(c, toView(await requireInvite(c))));

interface ChannelPlan {
  create: Array<{ name: string; handle: string | null }>;
  transfer: string[];
}

function channelPlan(input: unknown): ChannelPlan {
  const raw = (input && typeof input === 'object' ? input : {}) as { create?: unknown; transfer?: unknown };
  const create = (Array.isArray(raw.create) ? raw.create : [])
    .map((ch) => ({ name: str((ch as { name?: unknown })?.name, 100), handle: str((ch as { handle?: unknown })?.handle, 60) }))
    .filter((ch): ch is { name: string; handle: string | null } => !!ch.name);
  const transfer = [...new Set((Array.isArray(raw.transfer) ? raw.transfer : []).filter((id): id is string => typeof id === 'string' && !!id.trim()))];
  if (create.length + transfer.length > 10) throw new HttpError(400, 'invalid_request', 'At most 10 channels per invite');
  return { create, transfer };
}

/**
 * Invite: { email, name?, role: creator|viewer, tierId?, authRoles?: ['Scholar'], locale: en|ar, note?,
 * expiresInDays?, channels?: { create: [{name, handle?}], transfer: [channelId] } }.
 */
app.post('/', async (c) => {
  need(c, 'users:manage');
  const input = await body(c);
  const email = normalizeEmail(String(input.email ?? ''));
  if (!isEmailAddress(email)) throw new HttpError(400, 'invalid_email', 'A valid email is required');
  const role = input.role === 'viewer' ? 'viewer' : 'creator';
  const tierId = role === 'creator' ? str(input.tierId, 64) : null;
  if (tierId) need(c, 'creators:manage');
  const locale = input.locale === 'ar' ? 'ar' : 'en';
  const days = input.expiresInDays === undefined || input.expiresInDays === null ? DEFAULT_INVITE_DAYS : Number(input.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) throw new HttpError(400, 'invalid_request', `expiresInDays must be 1 to ${MAX_INVITE_DAYS}`);
  const authRoles = Array.isArray(input.authRoles) ? [...new Set(input.authRoles)] : [];
  if (authRoles.some((r) => !(INVITE_AUTH_ROLES as readonly unknown[]).includes(r))) throw new HttpError(400, 'role_not_grantable', `An invite can only add: ${INVITE_AUTH_ROLES.join(', ')}`);
  const plan = channelPlan(input.channels);
  if (plan.create.length) need(c, 'channels:manage');
  if (plan.transfer.length) need(c, 'channels:transfer');
  await limit(c);

  if (tierId) {
    const tiers = await videos<{ items?: Array<{ id: string }> } | Array<{ id: string }>>(c, '/creator-tiers');
    const list = Array.isArray(tiers) ? tiers : tiers.items ?? [];
    if (!list.some((t) => t.id === tierId)) throw new HttpError(400, 'unknown_plan', 'This plan does not exist');
  }

  const existing = await lookup(c, email);
  if (existing.authUser) throw new HttpError(409, 'user_exists', 'This email already has an account', { user: existing.authUser });
  if (existing.invite) throw new HttpError(409, 'already_invited', 'This email already has an open invite', { invite: existing.invite });
  if (existing.profile) throw new HttpError(409, 'user_exists', 'A videos user already has this email', { user: { id: existing.profile.id, email, name: existing.profile.displayName, status: 'active' } });

  const row = {
    id: newInviteId(),
    userId: newUserId(),
    email,
    name: str(input.name, 100),
    locale: locale as 'en' | 'ar',
    note: str(input.note, 1000),
    role: role as 'creator' | 'viewer',
    tierId,
    authRoles: authRoles as string[],
    expiresInDays: days,
    continueUrl: signInUrl(c.env, locale),
    createdBy: actorOf(c),
    createdByEmail: auth(c)?.email ?? null,
  };
  await insertInvite(c.env.REPORTS_DB, row);
  const ref = { id: row.id, user_id: row.userId };
  try {
    await videos(c, '/users/provision', { method: 'POST', json: { userId: row.userId, email, displayName: row.name } });
  } catch (error) {
    // Nothing exists yet anywhere else: drop the row so the admin can simply try again
    await c.env.REPORTS_DB.prepare('DELETE FROM creator_invites WHERE id = ?').bind(row.id).run();
    throw error;
  }
  await record(c, 'created', ref, { email, role, tierId, locale, authRoles });

  const warnings: Array<{ step: string; code: string; message: string }> = [];
  if (tierId) {
    try {
      await videos(c, `/users/${row.userId}/creator-tier`, { method: 'PUT', json: { tierId, source: 'admin' } });
      await writeAudit(c.env.REPORTS_DB, { kind: 'user', id: row.userId, action: 'creator-tier', actorId: actorOf(c), details: { tierId, source: 'admin', inviteId: row.id }, previous: { tierId: null, source: null } });
    } catch (error) {
      warnings.push({ step: 'plan', code: error instanceof VideosError ? error.code : 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  const channels: InviteChannel[] = [];
  for (const ch of plan.create) {
    try {
      const { channel } = await videos<{ channel: { id: string; name: string; handle?: string } }>(c, `/users/${row.userId}/channels`, { method: 'POST', json: ch });
      channels.push({ id: channel.id, name: channel.name, handle: channel.handle ?? null, action: 'created' });
      await writeAudit(c.env.REPORTS_DB, { kind: 'channel', id: channel.id, action: 'create-for-invite', actorId: actorOf(c), details: { ownerId: row.userId, inviteId: row.id } });
    } catch (error) {
      warnings.push({ step: `channel:${ch.name}`, code: error instanceof VideosError ? error.code : 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const id of plan.transfer) {
    try {
      const current = await videos<{ ownerId?: string | null; name?: string; handle?: string | null }>(c, `/channels/${encodeURIComponent(id)}`);
      const { job } = await videos<{ job: { id: string } }>(c, `/channels/${encodeURIComponent(id)}/transfer`, { method: 'POST', json: { newOwnerId: row.userId } });
      channels.push({ id, name: current.name ?? id, handle: current.handle ?? null, action: 'transferred', jobId: job?.id ?? null });
      await writeAudit(c.env.REPORTS_DB, { kind: 'channel', id, action: 'transfer', actorId: actorOf(c), details: { newOwnerId: row.userId, inviteId: row.id }, previous: { ownerId: current.ownerId ?? null } });
    } catch (error) {
      warnings.push({ step: `transfer:${id}`, code: error instanceof VideosError ? error.code : 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (channels.length) await addChannels(c.env.REPORTS_DB, row.id, channels);
  await enqueue(queueEnv(c), row.id, 'create');
  logger.info('[Invites] Invite created', { inviteId: row.id, userId: row.userId, channels: channels.length, warnings: warnings.length });
  return ok(c, { invite: toView((await getInvite(c.env.REPORTS_DB, row.id))!), warnings }, 201);
});

/** A queued change to auth (the mirror shows it as pending until auth has it). */
async function queueOp(c: C, row: InviteRow, op: Exclude<InviteOp, 'create' | 'sync'>, args: Record<string, unknown>) {
  const withActor = { ...args, actor: { id: actorOf(c), email: auth(c)?.email ?? null } };
  await setPendingOp(c.env.REPORTS_DB, row.id, op, withActor);
  await enqueue(queueEnv(c), row.id, op, withActor);
}

function requireOpen(row: InviteRow) {
  if (row.deleted_at) throw new HttpError(409, 'revoked', 'This invite was revoked; restore it first');
  if (row.accepted_at || row.status === 'active') throw new HttpError(409, 'already_accepted', 'This invite was already accepted');
}

app.post('/:id/resend', async (c) => {
  need(c, 'users:manage');
  await limit(c);
  const row = await requireInvite(c);
  requireOpen(row);
  const input = await body(c);
  const locale = input.locale === 'ar' || input.locale === 'en' ? input.locale : undefined;
  await queueOp(c, row, 'resend', locale ? { locale } : {});
  await record(c, 'resent', row, locale ? { locale } : {});
  return ok(c, toView((await getInvite(c.env.REPORTS_DB, row.id))!));
});

/**
 * Copy link: a new single-use link, shown once. Only its hash goes to auth;
 * the emailed link stops working. Usable once auth has the change (seconds).
 */
app.post('/:id/link', async (c) => {
  need(c, 'users:manage');
  await limit(c);
  const row = await requireInvite(c);
  requireOpen(row);
  if (!c.env.Issuer) throw new HttpError(409, 'not_configured', 'The auth server URL (Issuer) is not configured');
  const token = newLinkToken();
  await queueOp(c, row, 'link', { tokenHash: await sha256Hex(token) });
  await record(c, 'link_created', row);
  const url = `${new URL(c.env.Issuer).origin}/invite/${token}${row.locale === 'ar' ? '?lang=ar' : ''}`;
  return ok(c, { invite: toView((await getInvite(c.env.REPORTS_DB, row.id))!), url });
});

/** Revoke (soft delete): restorable for 30 days, then purged by auth's cleanup. */
app.post('/:id/revoke', async (c) => {
  need(c, 'users:manage');
  await limit(c);
  const row = await requireInvite(c);
  if (row.deleted_at) return ok(c, toView(row));
  if (row.accepted_at || row.status === 'active') throw new HttpError(409, 'already_accepted', 'This invite was already accepted; manage the user instead');
  const reason = str((await body(c)).reason, 500);
  const now = new Date().toISOString();
  await c.env.REPORTS_DB.prepare('UPDATE creator_invites SET deleted_at = ?, deleted_by = ?, deleted_reason = ?, updated_at = ? WHERE id = ?').bind(now, actorOf(c), reason, now, row.id).run();
  await queueOp(c, row, 'revoke', { reason });
  await record(c, 'revoked', row, { reason });
  return ok(c, toView((await getInvite(c.env.REPORTS_DB, row.id))!));
});

app.post('/:id/restore', async (c) => {
  need(c, 'users:manage');
  await limit(c);
  const row = await requireInvite(c);
  if (!row.deleted_at) return ok(c, toView(row));
  const other = await liveInviteForEmail(c.env.REPORTS_DB, row.email);
  if (other) throw new HttpError(409, 'email_taken', 'Another open invite uses this email', { invite: toView(other) });
  const now = new Date().toISOString();
  await c.env.REPORTS_DB.prepare('UPDATE creator_invites SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL, purge_requested_at = NULL, updated_at = ? WHERE id = ?').bind(now, row.id).run();
  if (row.delivery_status === 'sent') await queueOp(c, row, 'restore', {});
  else {
    // Revoked before auth had it: make it now
    await c.env.REPORTS_DB.prepare("UPDATE creator_invites SET delivery_status = 'sending', delivery_error = NULL WHERE id = ?").bind(row.id).run();
    await enqueue(queueEnv(c), row.id, 'create');
  }
  await record(c, 'restored', row);
  return ok(c, toView((await getInvite(c.env.REPORTS_DB, row.id))!));
});

/** "Delete permanently now": type the email to confirm; only queues it for auth's cleanup. */
app.post('/:id/purge', async (c) => {
  need(c, 'users:manage');
  await limit(c);
  const row = await requireInvite(c);
  if (!row.deleted_at) throw new HttpError(409, 'not_revoked', 'Revoke the invite first');
  const confirm = normalizeEmail(String((await body(c)).confirm ?? ''));
  if (confirm !== row.email) throw new HttpError(400, 'confirm_mismatch', 'Type the invite email to confirm');
  const now = new Date().toISOString();
  await c.env.REPORTS_DB.prepare('UPDATE creator_invites SET purge_requested_at = ?, updated_at = ? WHERE id = ?').bind(now, now, row.id).run();
  if (row.delivery_status === 'sent') await queueOp(c, row, 'purge', { confirm: row.email });
  await record(c, 'purge_requested', row);
  return ok(c, toView((await getInvite(c.env.REPORTS_DB, row.id))!));
});

/** Retry: the account's creation (failed) or the last change that failed. */
app.post('/:id/retry', async (c) => {
  need(c, 'users:manage');
  await limit(c);
  const row = await requireInvite(c);
  if (row.delivery_status === 'failed' && !row.deleted_at) {
    await c.env.REPORTS_DB.prepare("UPDATE creator_invites SET delivery_status = 'sending', delivery_error = NULL, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
    await enqueue(queueEnv(c), row.id, 'create');
  } else if (row.pending_op) {
    const { op, args } = JSON.parse(row.pending_op) as { op: InviteOp; args?: Record<string, unknown> };
    await c.env.REPORTS_DB.prepare('UPDATE creator_invites SET op_error = NULL WHERE id = ?').bind(row.id).run();
    await enqueue(queueEnv(c), row.id, op, args);
  } else throw new HttpError(409, 'nothing_to_retry', 'Nothing failed on this invite');
  await record(c, 'retried', row);
  return ok(c, toView((await getInvite(c.env.REPORTS_DB, row.id))!));
});

export default app;
