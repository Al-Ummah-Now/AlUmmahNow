/**
 * /api/csam/* — CSAM cases (docs/specs/CSAM-RESPONSE.md). Super admins only: no permission,
 * role or channel role grants access. Evidence downloads, holds, settings and the webhook secret
 * also need a step-up (middleware/step-up-routes.ts). Every read and action of a case is in its
 * access log (lib/csam.ts logAccess).
 *
 *   GET  /                    cases (?status=)
 *   POST /intake              { text }: one case per matched URL; mapped ones are taken down at once
 *   GET  /settings            retention and webhook state
 *   PUT  /settings            { retentionDays } (365–3650)
 *   POST /settings/webhook-secret   a new Cloudflare webhook secret, shown once
 *   GET  /log                 settings changes
 *   GET  /:id                 the case (job, evidence list, report facts, freeze)
 *   POST /:id/map             hand mapping of an unmapped case
 *   POST /:id/retry           the takedown (and freeze) again
 *   POST /:id/reported        { reportId, reportedAt }
 *   POST /:id/hold            { on, reason }
 *   GET  /:id/log             the case's access log
 *   GET  /:id/files/:name     one evidence file (attachment)
 */
import { Hono, type Context } from 'hono';
import { CSAM_CASE_STATUSES, isSuperAdmin } from '@al-ummah/shared-types';
import type { AuthContext } from '../base/types';
import { VideosError } from '../lib/content/videosClient';
import { logger } from '../lib/logger';
import {
  accessLog,
  caseDetail,
  CsamError,
  downloadEvidence,
  generateWebhookSecret,
  listCases,
  mapCase,
  markReported,
  openCases,
  readSettings,
  retryCase,
  setLegalHold,
  setRetentionDays,
  type CsamEnv,
} from '../lib/csam';

type Env = { Bindings: CsamEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')!.userId;
const body = async (c: C): Promise<Record<string, unknown>> => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};
const ok = (c: C, result: unknown) => c.json({ success: true, result });

app.use('*', async (c, next) => {
  const auth = c.get('auth');
  if (!auth?.userId || !isSuperAdmin(auth.roles)) {
    logger.warn('[CSAM] Not a super admin', { userId: auth?.userId ?? null, path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'Super admins only' }, 403);
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof CsamError) return c.json({ success: false, code: error.code, error: error.message }, error.status);
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message }, (error.status >= 400 && error.status < 600 ? error.status : 502) as 400);
  logger.error('[CSAM] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

app.get('/', async (c) => {
  const status = c.req.query('status');
  if (status && !(CSAM_CASE_STATUSES as readonly string[]).includes(status)) throw new CsamError(400, 'invalid_status');
  return ok(c, { items: await listCases(c.env, { status: status || undefined }) });
});

app.post('/intake', async (c) => {
  const { text } = await body(c);
  if (typeof text !== 'string' || !text.trim()) throw new CsamError(400, 'text_required');
  return ok(c, await openCases(c.env, { text, source: 'paste', actorId: actorOf(c) }));
});

app.get('/settings', async (c) => ok(c, await readSettings(c.env)));
app.put('/settings', async (c) => ok(c, await setRetentionDays(c.env, (await body(c)).retentionDays, actorOf(c))));
app.post('/settings/webhook-secret', async (c) => ok(c, await generateWebhookSecret(c.env, actorOf(c))));
app.get('/log', async (c) => ok(c, { items: await accessLog(c.env.REPORTS_DB, null) }));

app.get('/:id', async (c) => ok(c, await caseDetail(c.env, c.req.param('id'), actorOf(c))));
app.post('/:id/map', async (c) => ok(c, await mapCase(c.env, c.req.param('id'), await body(c), actorOf(c))));
app.post('/:id/retry', async (c) => ok(c, await retryCase(c.env, c.req.param('id'), actorOf(c))));
app.post('/:id/reported', async (c) => ok(c, await markReported(c.env, c.req.param('id'), await body(c), actorOf(c))));
app.post('/:id/hold', async (c) => ok(c, await setLegalHold(c.env, c.req.param('id'), await body(c), actorOf(c))));
app.get('/:id/log', async (c) => {
  await caseExists(c);
  return ok(c, { items: await accessLog(c.env.REPORTS_DB, c.req.param('id')) });
});
app.get('/:id/files/:name', async (c) => downloadEvidence(c.env, c.req.param('id'), c.req.param('name'), actorOf(c)));

async function caseExists(c: C): Promise<void> {
  const id = c.req.param('id') ?? '';
  const row = /^[A-Za-z0-9-]{8,64}$/.test(id) ? await c.env.REPORTS_DB.prepare('SELECT id FROM csam_cases WHERE id = ?').bind(id).first() : null;
  if (!row) throw new CsamError(404, 'not_found');
}

export default app;
