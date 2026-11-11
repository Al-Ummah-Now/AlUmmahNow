/**
 * /api/moderation/queue/* — the reports queue (shared-types report-queue.ts).
 *
 *   GET  /                                    Action needed (ReportQueueQuery → ReportQueueResult)
 *   GET  /history                             History (ReportHistoryQuery → ReportHistoryResult)
 *   GET  /items/:entityType/:entityId         One item (→ ReportItemResult)
 *   POST /items/:entityType/:entityId/action  One decision for all its open reports (ReportDecisionInput → ReportDecisionResult)
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts): every admin role
 * reads and decides, like the report page; the `banned` outcome also needs the
 * users:manage content permission (403 otherwise).
 */
import { Hono, type Context } from 'hono';
import { REPORT_ENTITY_TYPES, REPORT_OUTCOMES, type ModerationAction, type ReportableEntityType, type ReportDecisionResult } from '@al-ummah/shared-types';
import { listHistory, listQueue, openReportsOf, parseHistoryQuery, parseQueueQuery, QueueQueryError, readItem } from '../lib/moderation/reportQueue';
import { syncReportMeta } from '../lib/moderation/reportMeta';
import { decide, DecisionError, type DecisionEnv } from '../lib/moderation/reportDecision';
import { VideosError } from '../lib/content/videosClient';
import { logger } from '../lib/logger';
import type { AuthContext } from '../base/types';

type Env = { Bindings: DecisionEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

/** Rows whose copies are filled before a list is read (the cron fills the rest). */
const READ_SYNC = 50;

app.onError((error, c) => {
  if (error instanceof QueueQueryError) return c.json({ success: false, code: 'invalid_request', error: error.message }, 400);
  if (error instanceof DecisionError) {
    if (error.status === 403) logger.warn('[ReportQueue] Permission denied', { userId: c.get('auth')?.userId, path: c.req.path });
    return c.json({ success: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  logger.error('[ReportQueue] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

/** New reports get their names and titles before the search runs; a failure only leaves them for the cron. */
async function fillCopies(c: C) {
  await syncReportMeta(c.env, { limit: READ_SYNC }).catch((error) =>
    logger.warn('[ReportQueue] Copy fill before read failed', { error: error instanceof Error ? error.message : String(error) }),
  );
}

const queryOf = (c: C) => c.req.query() as Record<string, string | undefined>;

function itemParams(c: C): { type: ReportableEntityType; id: string } {
  const type = c.req.param('entityType') ?? '';
  const id = (c.req.param('entityId') ?? '').trim();
  if (!(REPORT_ENTITY_TYPES as readonly string[]).includes(type) || !id || id.length > 200) {
    throw new QueueQueryError(`entityType must be one of ${REPORT_ENTITY_TYPES.join(', ')} and entityId 1-200 characters`);
  }
  return { type: type as ReportableEntityType, id };
}

app.get('/', async (c) => {
  const query = parseQueueQuery(queryOf(c));
  await fillCopies(c);
  const result = await listQueue(c.env, query);
  logger.debug('[ReportQueue] Action needed listed', { userId: c.get('auth')?.userId, search: !!query.q, count: result.items.length, total: result.total });
  return c.json({ success: true, result });
});

app.get('/history', async (c) => {
  const query = parseHistoryQuery(queryOf(c));
  await fillCopies(c);
  const result = await listHistory(c.env, query);
  logger.debug('[ReportQueue] History listed', { userId: c.get('auth')?.userId, search: !!query.q, count: result.items.length, total: result.total });
  return c.json({ success: true, result });
});

app.get('/items/:entityType/:entityId', async (c) => {
  const { type, id } = itemParams(c);
  return c.json({ success: true, result: await readItem(c.env, type, id) });
});

app.post('/items/:entityType/:entityId/action', async (c) => {
  const { type, id } = itemParams(c);
  const body = (await c.req.json().catch(() => ({}))) as { action?: unknown; notes?: unknown };
  if (typeof body.action !== 'string' || !(REPORT_OUTCOMES as readonly string[]).includes(body.action)) {
    throw new QueueQueryError(`action must be one of ${REPORT_OUTCOMES.join(', ')}`);
  }
  if (body.notes !== undefined && body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
    throw new QueueQueryError('notes must be text of at most 2000 characters');
  }
  const reports = await openReportsOf(c.env.REPORTS_DB, type, id);
  if (reports.length === 0) return c.json({ success: false, code: 'already_closed', error: 'This item has no open reports' }, 409);
  const auth = c.get('auth');
  const outcome = await decide(c.env, {
    reports,
    action: body.action as ModerationAction,
    notes: (body.notes as string | null | undefined) ?? null,
    actorId: auth?.userId ?? 'unknown',
    roles: auth?.roles,
  });
  const result: ReportDecisionResult = outcome;
  return c.json({ success: true, result });
});

export default app;
