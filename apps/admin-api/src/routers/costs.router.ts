/**
 * /api/costs/* — the videos admin Costs page (COST-1). Behind authMiddleware + adminMiddleware
 * (src/index.ts). Admins (`ops:read`) see the dashboard and manage their own alert emails; super
 * admins (`ops:manage`) also set the connections and the alert settings. Every change is audited
 * in site_settings_log. Keys are never returned: only last4, who set it and when, the last test.
 *
 *   GET    /                         dashboard: budget, forecast, products, envs, movers, alerts, collector state
 *   GET    /credentials              the three connections (ops:manage)
 *   PUT    /credentials/:provider    { value } seal, store, test (ops:manage)
 *   POST   /credentials/:provider/test   test the stored key again (ops:manage)
 *   DELETE /credentials/:provider    remove (ops:manage)
 *   PUT    /settings                 alert settings (ops:manage)
 *   GET    /subscriptions/me         my alert emails
 *   PUT    /subscriptions/me         { kinds: ['budget'|'spike'|'digest'|'capacity'], locale }
 *   GET    /databases                D1 capacity: every database's size, trend, days to 70%, activity, open alerts; the account total; the capacity rules
 *   PUT    /d1-limits                { maxDbGb, accountGb } the limits the capacity alerts judge against (ops:manage)
 *   GET    /fixed                    fixed and other costs (COST-GAPS)
 *   POST   /fixed                    { name, amountUsd, period: monthly|yearly, startDate, endDate?, note? } (ops:manage)
 *   PUT    /fixed/:id                same body (ops:manage)
 *   DELETE /fixed/:id                (ops:manage)
 */
import { Hono, type Context } from 'hono';
import { isCostProvider, parseFixedCostInput, validateCostCredential } from '@al-ummah/shared-types';
import { createFixedCost, deleteFixedCost, listFixedCosts, updateFixedCost } from '../lib/fixedCosts';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { loadCostSettings } from '../lib/opsCost';
import { logger } from '../lib/logger';
import { databasesOverview } from '../lib/d1Capacity';
import type { AdminBindings, AuthContext } from '../base/types';
import {
  costsDashboard,
  listCredentials,
  mySubscription,
  removeCredential,
  retestCredential,
  checkCollectorAgain,
  saveCredential,
  saveD1Limits,
  saveSettings,
  setMySubscription,
  type Actor,
} from '../lib/costs';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const roles = (c: C) => normalizeRoles(c.get('auth')?.roles);
const canManage = (c: C) => hasPermission(roles(c), 'ops:manage');

export function actorOf(auth: AuthContext | undefined): Actor {
  const p = auth?.payload ?? {};
  const name = [p.name, p.display_name, p.displayName, p.properties?.name].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  return { id: auth?.userId ?? 'unknown', name: name?.trim().slice(0, 120) ?? auth?.email ?? null };
}

/**
 * The platform's monthly budget, the one admin-set value (#1427), for pages that project against
 * it without the Costs page's ops:read (Delivery's projection is for media managers). Only the
 * number, or null when COSTS_DB is missing or no budget is set yet.
 */
app.get('/budget', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!hasPermission(roles(c), 'ops:read') && !hasPermission(roles(c), 'media:manage')) {
    return c.json({ success: false, code: 'forbidden', error: 'The ops:read or media:manage permission is required' }, 403);
  }
  const budgetUsd = c.env.COSTS_DB ? (await loadCostSettings(c.env.COSTS_DB)).budgetUsd : null;
  return c.json({ success: true, result: { budgetUsd } });
});

app.use('*', async (c, next) => {
  if (c.req.method === 'GET' && c.req.path.endsWith('/costs/budget')) return next();
  c.header('Cache-Control', 'private, no-store');
  if (!hasPermission(roles(c), 'ops:read')) {
    logger.warn('[Costs] Permission denied', { userId: c.get('auth')?.userId, path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The ops:read permission is required' }, 403);
  }
  if (!c.env.COSTS_DB) return c.json({ success: false, code: 'not_configured', error: 'Costs are not configured here' }, 503);
  return next();
});

app.onError((error, c) => {
  if (/no such table/i.test(String((error as Error)?.message))) {
    return c.json({ success: false, code: 'not_ready', error: 'The cost tables are not migrated yet' }, 503);
  }
  logger.error('[Costs] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

const bad = (c: C, error: string, code = 'bad_request') => c.json({ success: false, code, error }, 400);
const forbidden = (c: C) => c.json({ success: false, code: 'forbidden', error: 'The ops:manage permission is required' }, 403);

app.get('/', async (c) => {
  const result = await costsDashboard(c.env as never);
  const manage = canManage(c);
  return c.json({
    success: true,
    result: {
      ...result,
      canManage: manage,
      // Admins who cannot manage see only whether each connection is set (no who/last4)
      connections: (await listCredentials(c.env as never)).map((v) => (manage ? v : { provider: v.provider, set: v.set, last4: null, updatedBy: null, updatedByName: null, updatedAt: null, test: v.test ? { ...v.test, message: '' } : null })),
      me: await mySubscription(c.env as never, c.get('auth')?.userId ?? ''),
    },
  });
});

app.get('/credentials', async (c) => {
  if (!canManage(c)) return forbidden(c);
  return c.json({ success: true, result: await listCredentials(c.env as never) });
});

app.put('/credentials/:provider', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const provider = c.req.param('provider');
  if (!isCostProvider(provider)) return bad(c, 'provider must be cloudflare, bunny or resend');
  const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
  const invalid = validateCostCredential(provider, body?.value);
  if (invalid) return bad(c, invalid, 'invalid_key');
  const out = await saveCredential(c.env as never, provider, String(body!.value), actorOf(c.get('auth')));
  return c.json({ success: true, result: out });
});

app.post('/credentials/:provider/test', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const provider = c.req.param('provider');
  if (!isCostProvider(provider)) return bad(c, 'provider must be cloudflare, bunny or resend');
  const out = await retestCredential(c.env as never, provider, actorOf(c.get('auth')));
  if (!out) return c.json({ success: false, code: 'not_set', error: 'No key is set for this provider' }, 404);
  return c.json({ success: true, result: out });
});

// "Check again" after a refused token: queues an hourly collection and re-tests the admin token
app.post('/collector/check', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const out = await checkCollectorAgain(c.env as never, actorOf(c.get('auth')));
  if (!out.queued && !out.tested) return c.json({ success: false, code: 'unavailable', error: 'Nothing to run: no job queue here and no token set' }, 503);
  return c.json({ success: true, result: out });
});

app.delete('/credentials/:provider', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const provider = c.req.param('provider');
  if (!isCostProvider(provider)) return bad(c, 'provider must be cloudflare, bunny or resend');
  const removed = await removeCredential(c.env as never, provider, actorOf(c.get('auth')));
  if (!removed) return c.json({ success: false, code: 'not_set', error: 'No key is set for this provider' }, 404);
  return c.json({ success: true, result: { provider, set: false } });
});

app.put('/settings', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const out = await saveSettings(c.env as never, await c.req.json().catch(() => null), actorOf(c.get('auth')));
  if (typeof out === 'string') return bad(c, out);
  return c.json({ success: true, result: out });
});

app.get('/databases', async (c) => {
  const overview = await databasesOverview(c.env.COSTS_DB!);
  return c.json({ success: true, result: { ...overview, canManage: canManage(c) } });
});

app.put('/d1-limits', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const out = await saveD1Limits(c.env as never, await c.req.json().catch(() => null), actorOf(c.get('auth')));
  if (typeof out === 'string') return bad(c, out);
  return c.json({ success: true, result: out });
});

app.get('/subscriptions/me', async (c) => {
  return c.json({ success: true, result: await mySubscription(c.env as never, c.get('auth')?.userId ?? '') });
});

app.put('/subscriptions/me', async (c) => {
  const auth = c.get('auth');
  const email = auth?.email ?? (typeof auth?.payload?.email === 'string' ? auth.payload.email : undefined);
  if (!auth?.userId || !email) return bad(c, 'Your account has no email address to send alerts to', 'no_email');
  const out = await setMySubscription(c.env as never, { ...actorOf(auth), email }, await c.req.json().catch(() => null));
  if (typeof out === 'string') return bad(c, out);
  return c.json({ success: true, result: out });
});

const FIXED_ID = /^[0-9a-f-]{36}$/;

app.get('/fixed', async (c) => c.json({ success: true, result: await listFixedCosts(c.env.COSTS_DB as never) }));

app.post('/fixed', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const input = parseFixedCostInput(await c.req.json().catch(() => null));
  if ('error' in input) return c.json({ success: false, code: 'invalid_fixed_cost', field: input.field, error: input.error }, 400);
  const out = await createFixedCost(c.env as never, input, actorOf(c.get('auth')).id);
  if (out === 'too_many') return c.json({ success: false, code: 'too_many', error: 'Too many fixed costs; remove one first' }, 409);
  return c.json({ success: true, result: out }, 201);
});

app.put('/fixed/:id', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const id = c.req.param('id');
  if (!FIXED_ID.test(id)) return bad(c, 'id must be a fixed cost id');
  const input = parseFixedCostInput(await c.req.json().catch(() => null));
  if ('error' in input) return c.json({ success: false, code: 'invalid_fixed_cost', field: input.field, error: input.error }, 400);
  const out = await updateFixedCost(c.env as never, id, input, actorOf(c.get('auth')).id);
  if (!out) return c.json({ success: false, code: 'not_found', error: 'No such fixed cost' }, 404);
  return c.json({ success: true, result: out });
});

app.delete('/fixed/:id', async (c) => {
  if (!canManage(c)) return forbidden(c);
  const id = c.req.param('id');
  if (!FIXED_ID.test(id)) return bad(c, 'id must be a fixed cost id');
  const removed = await deleteFixedCost(c.env as never, id, actorOf(c.get('auth')).id);
  if (!removed) return c.json({ success: false, code: 'not_found', error: 'No such fixed cost' }, 404);
  return c.json({ success: true, result: { id, removed: true } });
});

export default app;
