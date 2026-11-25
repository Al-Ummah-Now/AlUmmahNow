/**
 * /api/audit — the admin audit log page (issue #711) — and /api/names (issue #745).
 *
 *   GET  /api/audit?actorId=&itemKind=&itemId=&area=&action=&from=&to=&cursor=&limit=
 *        one page of the merged feed (lib/audit/feed.ts) with names for every id it mentions
 *   GET  /api/audit/actions   every recorded action with its area (the Action filter)
 *   POST /api/names           { users?, items? } → names (every admin page that shows ids)
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts). The audit log needs audit:read; names
 * are what the pages already show by id, so every admin role may ask; emails only with audit:read.
 * Reads only: no audit row.
 */
import { Hono, type Context } from 'hono';
import type { AdminAuditFeedPage } from '@al-ummah/shared-types';
import { cleanAuditQuery, readAuditActions, readAuditFeed } from '../lib/audit/feed';
import { cleanNamesRequest, idsOfFeed, resolveNames } from '../lib/audit/names';
import { hasPermission } from '../lib/roles';
import { logger } from '../lib/logger';
import type { VideosClientEnv } from '../lib/content/videosClient';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const auditRouter = new Hono<Env>();
export const namesRouter = new Hono<Env>();

const canRead = (c: C) => hasPermission(c.get('auth')?.roles, 'audit:read');
const forbidden = (c: C) => c.json({ success: false, error: 'forbidden' }, 403);

auditRouter.get('/', async (c) => {
  if (!canRead(c)) return forbidden(c);
  const query = cleanAuditQuery(c.req.query());
  try {
    const page = await readAuditFeed(c.env.REPORTS_DB, query);
    const names = await resolveNames(c.env, cleanNamesRequest(idsOfFeed(page.items)), true, c.get('auth')?.roles);
    const body: AdminAuditFeedPage = { ...page, names };
    return c.json({ success: true, result: body });
  } catch (error) {
    logger.error('[Audit] Feed read failed', { error: error instanceof Error ? error : String(error) });
    return c.json({ success: false, error: 'audit_read_failed' }, 500);
  }
});

auditRouter.get('/actions', async (c) => {
  if (!canRead(c)) return forbidden(c);
  try {
    return c.json({ success: true, result: await readAuditActions(c.env.REPORTS_DB) });
  } catch (error) {
    logger.error('[Audit] Actions read failed', { error: error instanceof Error ? error : String(error) });
    return c.json({ success: false, error: 'audit_read_failed' }, 500);
  }
});

namesRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  return c.json({ success: true, result: await resolveNames(c.env, cleanNamesRequest(body), canRead(c), c.get('auth')?.roles) });
});
