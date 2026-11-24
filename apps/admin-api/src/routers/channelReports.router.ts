/**
 * GET /internal/channel-reports/:id (X-API-Key): whether a report about the channel is being
 * reviewed, for api-videos' channel moves (wiki AUN-CHANNEL-CLAIM §5). Says nothing about who
 * reported it or why. Read through idx_reports_open_entity.
 */
import { Hono } from 'hono';
import type { AdminBindings } from '../base/types';
import { apiError } from '../lib/api-error';
import { safeEqual } from '../lib/contact';

type Env = { Bindings: AdminBindings };

async function internalKey(env: AdminBindings): Promise<string> {
  const b = env.INTERNAL_API_KEY;
  try {
    return typeof b === 'string' ? b : ((await b?.get()) ?? '');
  } catch {
    return '';
  }
}

export const channelReportsRouter = new Hono<Env>();
channelReportsRouter.get('/:id', async (c) => {
  const expected = await internalKey(c.env);
  if (!expected || !safeEqual(c.req.header('X-API-Key') ?? '', expected)) return apiError(c, 401, 'unauthorized');
  const row = await c.env.REPORTS_DB.prepare(`SELECT 1 AS found FROM reports WHERE status = 'reviewing' AND entity_type = 'channel' AND entity_id = ? LIMIT 1`)
    .bind(c.req.param('id'))
    .first<{ found: number }>();
  return c.json({ success: true, result: { underReview: !!row } }, 200, { 'Cache-Control': 'no-store' });
});
