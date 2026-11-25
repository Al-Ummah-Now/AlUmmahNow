/**
 * What api-videos asks about reports (X-API-Key).
 *
 * GET /internal/channel-reports/:id: whether a report about the channel is being
 * reviewed, for api-videos' channel moves (wiki AUN-CHANNEL-CLAIM §5). Says nothing about who
 * reported it or why. Read through idx_reports_open_entity.
 *
 * POST /internal/report-outcomes {reporterId, ids}: what became of a person's own reports, for their
 * data export (Art. 15). Only their outcome and its date: never who decided, notes, or the other party.
 */
import { Hono, type Context } from 'hono';
import type { ReportFiledOutcome } from '@al-ummah/shared-types';
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

async function hasKey(c: Context<Env>): Promise<boolean> {
  const expected = await internalKey(c.env);
  return !!expected && safeEqual(c.req.header('X-API-Key') ?? '', expected);
}

export const channelReportsRouter = new Hono<Env>();
channelReportsRouter.get('/:id', async (c) => {
  if (!(await hasKey(c))) return apiError(c, 401, 'unauthorized');
  const row = await c.env.REPORTS_DB.prepare(`SELECT 1 AS found FROM reports WHERE status = 'reviewing' AND entity_type = 'channel' AND entity_id = ? LIMIT 1`)
    .bind(c.req.param('id'))
    .first<{ found: number }>();
  return c.json({ success: true, result: { underReview: !!row } }, 200, { 'Cache-Control': 'no-store' });
});

/** Reports in one request. */
const MAX_IDS = 500;

const outcomeOf = (r: { status: string; action: string | null }): ReportFiledOutcome =>
  r.status === 'dismissed' ? 'dismissed' : r.status !== 'resolved' ? 'open' : r.action && r.action !== 'dismissed' ? 'action_taken' : 'kept';

export const reportOutcomesRouter = new Hono<Env>();
reportOutcomesRouter.post('/', async (c) => {
  if (!(await hasKey(c))) return apiError(c, 401, 'unauthorized');
  const body = (await c.req.json().catch(() => null)) as { reporterId?: unknown; ids?: unknown } | null;
  const ids = body?.ids;
  if (typeof body?.reporterId !== 'string' || !body.reporterId || !Array.isArray(ids) || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) return apiError(c, 400, 'invalid_request');
  const { results } = await c.env.REPORTS_DB.prepare('SELECT r.id, r.status, r.action, r.resolved_at FROM json_each(?) j CROSS JOIN reports r ON r.id = j.value WHERE r.reporter_id = ?')
    .bind(JSON.stringify(ids), body.reporterId)
    .all<{ id: string; status: string; action: string | null; resolved_at: string | null }>();
  const outcomes = (results ?? []).map((r) => {
    const outcome = outcomeOf(r);
    return { id: r.id, outcome, decidedAt: outcome === 'open' ? null : r.resolved_at };
  });
  return c.json({ success: true, result: { outcomes } }, 200, { 'Cache-Control': 'no-store' });
});
