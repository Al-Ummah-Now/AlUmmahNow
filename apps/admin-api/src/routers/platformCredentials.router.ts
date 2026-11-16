/**
 * Platform settings → Credentials (lib/platform-credentials.ts). Behind authMiddleware +
 * adminMiddleware (src/index.ts); every route needs `credentials:manage` (Super Admin).
 *
 *   GET  /            { success, result: PlatformCredentialView[] }
 *   PUT  /:id         { value } → { success, result: { view, test } }  sealed, tested, audited; never echoed
 *   POST /:id/test    → { success, result: { view, test } }          tests the value in use, audited
 *   POST /:id/create  → { success, result: { view, test, previousRevoked, previousKept } }
 *                     Create / Rotate with the token manager: mint, test, store, revoke the old one if
 *                     minted here; audited. 409 no_manager / manager_invalid / manager_cannot_mint,
 *                     502 minted_token_failed (with the failed test) / store_refused
 */
import { Hono, type Context } from 'hono';
import { isCloudflareApiToken, isPlatformCredentialId } from '@al-ummah/shared-types';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { logger } from '../lib/logger';
import { CredentialError, listCredentialViews, mintCredential, replaceCredential, testCredential, type Actor, type CredentialsEnv } from '../lib/platform-credentials';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export function actorOf(auth: AuthContext | undefined): Actor {
  const name = typeof auth?.payload?.name === 'string' ? (auth.payload.name as string) : undefined;
  return { id: auth?.userId ?? 'unknown', name: name?.trim().slice(0, 120) || auth?.email || null };
}

const envOf = (c: C) => c.env as unknown as CredentialsEnv;
const app = new Hono<Env>();

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), 'credentials:manage')) {
    logger.warn('[Credentials] Permission denied', { userId: c.get('auth')?.userId, path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The credentials:manage permission (Super Admin) is required' }, 403);
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof CredentialError) return c.json({ success: false, code: error.code, error: error.message, ...(error.test ? { test: error.test } : {}) }, error.status);
  logger.error('[Credentials] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'failed', error: 'The change could not be made' }, 500);
});

app.get('/', async (c) => c.json({ success: true, result: await listCredentialViews(envOf(c)) }));

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isPlatformCredentialId(id)) return c.json({ success: false, code: 'not_found', error: 'No such credential' }, 404);
  const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
  // Checked before anything is written, so a bad value never reaches the audit log or storage
  if (!body || !isCloudflareApiToken(body.value)) {
    return c.json({ success: false, code: 'invalid_token', error: 'Enter a Cloudflare API token (30 to 200 letters, digits, - or _)' }, 400);
  }
  return c.json({ success: true, result: await replaceCredential(envOf(c), id, body.value, actorOf(c.get('auth'))) });
});

app.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  if (!isPlatformCredentialId(id)) return c.json({ success: false, code: 'not_found', error: 'No such credential' }, 404);
  return c.json({ success: true, result: await testCredential(envOf(c), id, actorOf(c.get('auth'))) });
});

app.post('/:id/create', async (c) => {
  const id = c.req.param('id');
  if (!isPlatformCredentialId(id)) return c.json({ success: false, code: 'not_found', error: 'No such credential' }, 404);
  return c.json({ success: true, result: await mintCredential(envOf(c), id, actorOf(c.get('auth'))) });
});

export default app;
