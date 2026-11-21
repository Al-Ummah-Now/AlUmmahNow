/**
 * /api/admin/import/* — Admin Tools, the desktop admin import app (wiki TOOLS-ADMIN, TA-3/TA-4/TA-12).
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts); Admin Tools' tokens are accepted by
 * admin-api's audience list (shared-types token-audience.ts `adminTools`). Every route here also needs
 * `imports:manage`; making a channel needs the `channels:manage` content permission too.
 *
 *   GET  /me         who is signed in and what the app may show: { userId, email, roles,
 *                    permissions, contentPermissions }
 *   GET  /encoding   the server's HLS ladder and encode settings (shared-types ENCODE_LADDER, the same
 *                    values as the media container's ladder.mjs) and the limits of a pre-encoded
 *                    upload, so the app encodes exactly what the server checks
 *   POST /channels   { name, handle?, description?, ownerId? } → 201 { channel } — a channel owned by
 *                    `ownerId` (a videos user; needs users:manage, as an invite does) or, without
 *                    one, by the acting admin; the same
 *                    validation as an admin making a channel for an invite (409 duplicate name or
 *                    taken handle) and no tier or max-channels check. Audited (content:import:<id>).
 */
import { Hono, type Context } from 'hono';
import { ENCODE_LADDER, PREBUILT_LIMITS, contentPermissionsFor, hasContentPermission } from '@al-ummah/shared-types';
import { hasPermission, normalizeRoles, permissionsFor } from '../lib/roles';
import { callVideos, VideosError, type VideosCall, type VideosClientEnv } from '../lib/content/videosClient';
import { dropAudit, setAuditSubject, writeAudit } from '../lib/content/audit';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

const auth = (c: C) => c.get('auth');
const actorOf = (c: C) => auth(c)?.userId ?? 'unknown';
const videos = <T>(c: C, path: string, call: VideosCall = {}) => callVideos<T>(c.env, path, { actorId: actorOf(c), ...call });
const fail = (c: C, status: 400 | 403 | 404, code: string, error: string) => c.json({ success: false, code, error }, status);

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(auth(c)?.roles), 'imports:manage')) {
    logger.warn('[AdminImport] Permission denied', { userId: actorOf(c), path: c.req.path });
    return fail(c, 403, 'forbidden', 'The imports:manage permission is required');
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  logger.error('[AdminImport] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

app.get('/me', (c) => {
  const a = auth(c);
  return c.json({
    success: true,
    result: {
      userId: actorOf(c),
      email: a?.email ?? null,
      roles: normalizeRoles(a?.roles ?? []),
      permissions: permissionsFor(a?.roles),
      contentPermissions: contentPermissionsFor(a?.roles),
    },
  });
});

app.get('/encoding', (c) => c.json({ success: true, result: { ladder: ENCODE_LADDER, prebuiltLimits: PREBUILT_LIMITS } }));

const USER_ID = /^usr_[0-9a-f]{32}$/;
const text = (v: unknown, max: number): string | null | undefined =>
  v === undefined || v === null ? undefined : typeof v === 'string' ? v.trim().slice(0, max) || undefined : null;

/** Validates a new channel: a name of 1–100 characters; handle, description and ownerId optional. */
export function parseNewChannel(body: unknown):
  | { ok: true; value: { name: string; handle?: string; description?: string; ownerId?: string } }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON object is required' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 100) return { ok: false, error: 'name is required (at most 100 characters)' };
  const handle = text(b.handle, 64);
  const description = text(b.description, 5000);
  if (handle === null) return { ok: false, error: 'handle must be text' };
  if (description === null) return { ok: false, error: 'description must be text' };
  if (b.ownerId !== undefined && b.ownerId !== null && (typeof b.ownerId !== 'string' || !USER_ID.test(b.ownerId))) {
    return { ok: false, error: 'ownerId must be a videos user id (usr_ followed by 32 hex digits)' };
  }
  return {
    ok: true,
    value: { name, ...(handle ? { handle } : {}), ...(description ? { description } : {}), ...(b.ownerId ? { ownerId: b.ownerId as string } : {}) },
  };
}

app.post('/channels', async (c) => {
  if (!hasContentPermission(auth(c)?.roles, 'channels:manage')) return fail(c, 403, 'forbidden', 'The channels:manage permission is required');
  const parsed = parseNewChannel(await c.req.json().catch(() => null));
  if (parsed.ok === false) return fail(c, 400, 'invalid_request', parsed.error);
  const { ownerId: chosen, ...input } = parsed.value;
  const ownerId = chosen ?? actorOf(c);
  // A channel for someone else is what an invite does: the same users:manage it needs (invites.router.ts)
  if (ownerId !== actorOf(c) && !hasContentPermission(auth(c)?.roles, 'users:manage')) {
    return fail(c, 403, 'forbidden', 'The users:manage permission is required to make a channel for another user');
  }
  const db = c.env.REPORTS_DB;
  // The channel id exists only once api-videos made it: the row is written first (so nothing goes
  // unaudited), pointed at the channel afterwards, and dropped if api-videos refuses.
  const auditId = await writeAudit(db, { kind: 'import', id: 'pending', action: 'channel:create', actorId: actorOf(c), details: { ownerId, name: input.name, ...(input.handle ? { handle: input.handle } : {}) } });
  try {
    const create = () => videos<{ channel: { id: string; name: string; handle?: string } }>(c, `/users/${ownerId}/channels`, { method: 'POST', json: input });
    let result: { channel: { id: string; name: string; handle?: string } };
    try {
      result = await create();
    } catch (error) {
      // An admin making a channel for themselves may have no videos profile yet: make it, then retry.
      if (!(error instanceof VideosError && error.code === 'user_not_found' && !chosen)) throw error;
      const email = auth(c)?.email;
      if (!email) throw error;
      await videos(c, '/users/provision', { method: 'POST', json: { userId: ownerId, email } });
      result = await create();
    }
    await setAuditSubject(db, auditId, 'import', result.channel.id).catch((e) =>
      logger.warn('[AdminImport] Could not point the audit row at the channel', { auditId, error: String(e) }),
    );
    logger.info('[AdminImport] Channel created', { channelId: result.channel.id, ownerId, actorId: actorOf(c) });
    return c.json({ success: true, result: { channel: result.channel } }, 201);
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
});

export default app;
