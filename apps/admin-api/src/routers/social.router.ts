/**
 * /api/social — social auto-post, the platform side (wiki AUN-SOCIAL, SOC-1; owner 2026-11-14: X, Telegram,
 * Bluesky and Mastodon, no Meta).
 *
 *   GET    /                         overview: settings, network readiness, this month's X spend, 7-day counts, failures
 *   PUT    /settings                 { enabled, networks: { x|telegram|bluesky|mastodon: { enabled } }, xMonthlyCapUsd }
 *   PUT    /credentials/:network     x: { clientId, clientSecret } · telegram: { botToken }
 *   DELETE /credentials/:network
 *   GET    /history                  the latest changes (audit log, newest first)
 *
 * Reads are open to every admin; changes need settings:manage (admins and super admins). The values live in
 * api-videos (SEARCH_DB social_settings, credentials sealed with SOCIAL_TOKEN_KEK). Every change is audited in
 * site_settings_log (keys social:settings and social:credentials:<network>) before api-videos is called, and the
 * row is removed again when that call fails. Credentials are never logged or audited: only "set" or "cleared".
 */
import { Hono, type Context } from 'hono';
import { hasPermission } from '../lib/roles';
import { logger } from '../lib/logger';
import type { ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { lookupMany } from '../lib/moderation/reportMeta';
import type { AdminBindings, AuthContext } from '../base/types';
import { auditOriginJson } from '../lib/request-origin';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const SOCIAL_SETTINGS_AUDIT_KEY = 'social:settings';
export const socialCredentialsAuditKey = (network: string) => `social:credentials:${network}`;
const CREDENTIAL_NETWORKS = ['x', 'telegram'] as const;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? code);
  }
}

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  logger.error('[Social] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

/** Calls api-videos /internal/social (service binding, INTERNAL_API_KEY); its error codes pass through. */
export async function callSocial<T>(env: ProcessingClientEnv, method: string, path: string, actorId: string, json?: unknown): Promise<T> {
  const binding = env.INTERNAL_API_KEY;
  const key = typeof binding === 'string' ? binding : await binding?.get();
  if (!key) throw new HttpError(500, 'not_configured', 'INTERNAL_API_KEY is not configured');
  const init: RequestInit = {
    method,
    headers: { 'X-API-Key': key, 'X-Admin-Actor': actorId, ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  };
  const url = `/internal/social${path}`;
  let res: Response;
  if (env.VIDEOS) res = await env.VIDEOS.fetch(`https://videos.internal${url}`, init);
  else if (env.VIDEOS_API_URL) res = await fetch(`${env.VIDEOS_API_URL.replace(/\/$/, '')}${url}`, init);
  else throw new HttpError(500, 'not_configured', 'The VIDEOS service binding is not configured');
  const payload = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) throw new HttpError(res.status, payload?.code ?? payload?.error ?? 'videos_error', payload?.error ?? `api-videos answered ${res.status}`);
  return payload as T;
}

function needManage(c: C) {
  if (!hasPermission(c.get('auth')?.roles, 'settings:manage')) {
    logger.warn('[Social] Permission denied', { userId: actorOf(c), path: c.req.path });
    throw new HttpError(403, 'forbidden', 'The settings:manage permission is required');
  }
}

/** Audits first, then runs the change; the audit row is dropped again when the change fails. */
async function audited<T>(c: C, key: string, oldValue: unknown, newValue: unknown, change: () => Promise<T>): Promise<T> {
  const db = c.env.REPORTS_DB;
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, key, oldValue === undefined ? null : JSON.stringify(oldValue), JSON.stringify(newValue), actorOf(c), new Date().toISOString(), auditOriginJson())
    .run();
  try {
    return await change();
  } catch (error) {
    await db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id).run().catch((dropError) =>
      logger.error('[Social] Could not drop the audit row of a failed change', { error: String(dropError) }),
    );
    throw error;
  }
}

app.get('/', async (c) => c.json({ success: true, result: await callSocial(c.env, 'GET', '/admin', actorOf(c)) }));

app.get('/history', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
  const { results } = await c.env.REPORTS_DB
    .prepare("SELECT id, key, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key >= 'social:' AND key < 'social;' ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .bind(limit)
    .all<{ id: string; key: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }>();
  const rows = results ?? [];
  // People by name, never by id (display name, else email; no @handle). Without the lookup the page says "an admin".
  const names = await lookupMany(c.env as never, [], rows.map((r) => r.actor_id)).catch(() => null);
  const entries = rows.map((r) => {
    const user = names?.users.get(r.actor_id);
    const actorName = (user?.found && (user.displayName?.trim() || user.email?.trim())) || null;
    return { id: r.id, key: r.key, oldValue: r.old_value, newValue: r.new_value, actorId: r.actor_id, actorName, createdAt: r.created_at };
  });
  return c.json({ success: true, result: { entries } });
});

app.put('/settings', async (c) => {
  needManage(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_request', 'A settings object is required');
  const current = await callSocial<{ settings: unknown }>(c.env, 'GET', '/admin', actorOf(c));
  const out = await audited(c, SOCIAL_SETTINGS_AUDIT_KEY, current.settings, body, () => callSocial<{ before: unknown; settings: unknown }>(c.env, 'PUT', '/admin/settings', actorOf(c), body));
  logger.info('[Social] Platform settings changed', { actorId: actorOf(c), settings: out.settings });
  return c.json({ success: true, result: { settings: out.settings } });
});

function credentialNetwork(c: C): (typeof CREDENTIAL_NETWORKS)[number] {
  const n = c.req.param('network');
  if (!(CREDENTIAL_NETWORKS as readonly string[]).includes(n ?? '')) throw new HttpError(400, 'invalid_network', 'Credentials are entered for x and telegram only');
  return n as (typeof CREDENTIAL_NETWORKS)[number];
}

app.put('/credentials/:network', async (c) => {
  needManage(c);
  const network = credentialNetwork(c);
  const raw = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  // Only the fields the network takes are forwarded; nothing else from the body
  const body = network === 'x' ? { clientId: raw.clientId, clientSecret: raw.clientSecret } : { botToken: raw.botToken };
  const out = await audited(c, socialCredentialsAuditKey(network), undefined, { action: 'set' }, () => callSocial<{ readiness: unknown }>(c.env, 'PUT', `/admin/credentials/${network}`, actorOf(c), body));
  logger.info('[Social] Network credentials set', { actorId: actorOf(c), network });
  return c.json({ success: true, result: out });
});

app.delete('/credentials/:network', async (c) => {
  needManage(c);
  const network = credentialNetwork(c);
  const out = await audited(c, socialCredentialsAuditKey(network), undefined, { action: 'cleared' }, () => callSocial<{ readiness: unknown }>(c.env, 'DELETE', `/admin/credentials/${network}`, actorOf(c)));
  logger.info('[Social] Network credentials cleared', { actorId: actorOf(c), network });
  return c.json({ success: true, result: out });
});

export default app;
