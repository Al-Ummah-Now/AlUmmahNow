/**
 * /api/trash/* — "Recently deleted" for the admin deletes this service owns (lib/trash.ts):
 * contact messages, custom themes and creator tiers.
 *
 *   GET  /:kind                 the kind's soft-deleted items (who, when, reason, purge date)
 *   POST /:kind/:id/restore     restore (admin-web asks for an in-app confirmation first)
 *   POST /:kind/:id/purge       "Delete permanently now": queues it for the next hourly cleanup
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts). Every route needs the permission that
 * deletes the kind (lib/trash.ts canManageTrash: admins and super admins, never moderators).
 */
import { Hono, type Context } from 'hono';
import { isTrashKind, type TrashKind } from '@al-ummah/shared-types';
import type { AdminBindings, AuthContext } from '../base/types';
import { VideosError, type VideosClientEnv } from '../lib/content/videosClient';
import { logger } from '../lib/logger';
import { canManageTrash, listTrash, requestTrashPurge, restoreTrash, TrashError } from '../lib/trash';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const ID = /^[A-Za-z0-9_:.-]{1,128}$/;

app.onError((error, c) => {
  if (error instanceof TrashError) return c.json({ success: false, code: error.code, error: error.message }, error.status);
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  logger.error('[Trash] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

/** The kind from the path when the caller may manage it, otherwise the error response. */
function kindOf(c: C): TrashKind | Response {
  const kind = c.req.param('kind');
  if (!isTrashKind(kind)) return c.json({ success: false, code: 'bad_request', error: 'Unknown kind' }, 400);
  if (!canManageTrash(c.get('auth')?.roles, kind)) {
    logger.warn('[Trash] Permission denied', { userId: actorOf(c), kind });
    return c.json({ success: false, code: 'forbidden', error: 'Admin role required' }, 403);
  }
  return kind;
}

function idOf(c: C): string | Response {
  const id = c.req.param('id') ?? '';
  return ID.test(id) ? id : c.json({ success: false, code: 'bad_request', error: 'Bad id' }, 400);
}

app.get('/:kind', async (c) => {
  const kind = kindOf(c);
  if (kind instanceof Response) return kind;
  return c.json({ success: true, result: { items: await listTrash(c.env, kind) } });
});

app.post('/:kind/:id/restore', async (c) => {
  const kind = kindOf(c);
  if (kind instanceof Response) return kind;
  const id = idOf(c);
  if (id instanceof Response) return id;
  await restoreTrash(c.env, kind, id, actorOf(c));
  return c.json({ success: true, result: { restored: id } });
});

app.post('/:kind/:id/purge', async (c) => {
  const kind = kindOf(c);
  if (kind instanceof Response) return kind;
  const id = idOf(c);
  if (id instanceof Response) return id;
  await requestTrashPurge(c.env, kind, id, actorOf(c));
  return c.json({ success: true, result: { queued: id } });
});

export default app;
