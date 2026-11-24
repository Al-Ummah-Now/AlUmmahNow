/**
 * GET /internal/channel-reports/:id (X-API-Key): whether a report about the channel is being
 * reviewed, for api-videos' channel moves (wiki AUN-CHANNEL-CLAIM §5). Says nothing about who
 * reported it or why. Read through idx_reports_open_entity.
 */
import { Hono } from 'hono';
import type { AdminBindings } from '../base/types';
import { apiError } from '../lib/api-error';

type Env = { Bindings: AdminBindings };

async function internalKey(env: AdminBindings): Promise<string> {
  const b = env.INTERNAL_API_KEY as string | { get(): Promise<string> } | undefined;
  try {
    return typeof b === 'string' ? b : ((await b?.get()) ?? '');
  } catch {
    return '';
  }
}

function sameKey(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const channelReportsRouter = new Hono<Env>();
channelReportsRouter.get('/:id', async (c) => {
  if (!sameKey(c.req.header('X-API-Key') ?? '', await internalKey(c.env))) return apiError(c, 401, 'unauthorized');
  const row = await c.env.REPORTS_DB.prepare(`SELECT 1 AS found FROM reports WHERE status = 'reviewing' AND entity_type = 'channel' AND entity_id = ? LIMIT 1`)
    .bind(c.req.param('id'))
    .first<{ found: number }>();
  return c.json({ success: true, result: { underReview: !!row } }, 200, { 'Cache-Control': 'no-store' });
});
