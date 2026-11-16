/**
 * /api/billing/* — the videos admin Payments page (wiki AUN-SUBS).
 *
 * A permission-checked, audited proxy to api-videos /internal/billing (the
 * billing data lives in its search D1). Credentials are the exception: they
 * are written to Secrets Store here (lib/billing-secrets.ts) and api-videos is
 * told only that one is set. No credential value is ever stored in D1,
 * written to the audit log, logged or returned.
 *
 *   billing:read       GET  /overview, /subscriptions, /subscriptions/:id, /users/:id
 *   billing:manage     PUT  /tax, /prices, /tiers/:id/sale-mode; DELETE /prices/:id
 *                      POST /subscriptions/:id/cancel, /comps
 *   billing:providers  PUT  /providers/:id, /providers/:id/credentials; POST /providers/:id/sync-prices
 *   billing:refund     POST /payments/:id/refund
 *
 * Admins hold read + manage; providers and refunds are super admin only
 * (ROLE_CONTENT_PERMISSIONS in shared-types).
 */
import { Hono, type Context } from 'hono';
import {
  hasContentPermission,
  PAYMENT_CREDENTIAL_FIELDS,
  PAYMENT_MODES,
  PAYMENT_PROVIDERS,
  type AdminBillingOverview,
  type AdminContentPermission,
  type PaymentCredentialField,
  type PaymentMode,
  type PaymentProviderId,
} from '@al-ummah/shared-types';
import type { AdminBindings, AuthContext } from '../base/types';
import { callVideos, VideosError, type VideosCall, type VideosClientEnv } from '../lib/content/videosClient';
import { dropAudit, setAuditPrevious, writeAudit, type AuditAction } from '../lib/content/audit';
import { credentialStorageReady, SecretsStoreError, writeCredential, type BillingSecretsEnv } from '../lib/billing-secrets';
import { logger } from '../lib/logger';

type Env = { Bindings: AdminBindings & VideosClientEnv & BillingSecretsEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const ok = (c: C, result: unknown) => c.json({ success: true, result });
const body = async (c: C): Promise<Record<string, unknown>> => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};
const videos = <T>(c: C, path: string, call: VideosCall = {}) => callVideos<T>(c.env, path, { actorId: actorOf(c), base: '/internal/billing', ...call });
const enc = encodeURIComponent;

class Forbidden extends Error {
  constructor(readonly permission: AdminContentPermission) {
    super(`The ${permission} permission is required`);
  }
}
class BadRequest extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function need(c: C, permission: AdminContentPermission) {
  if (!hasContentPermission(c.get('auth')?.roles, permission)) throw new Forbidden(permission);
}

app.onError((error, c) => {
  if (error instanceof Forbidden) {
    logger.warn('[Billing] Permission denied', { userId: actorOf(c as C), permission: error.permission, path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: error.message }, 403);
  }
  if (error instanceof BadRequest) return c.json({ success: false, code: error.code, error: error.message }, 400);
  if (error instanceof SecretsStoreError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 409);
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message }, (error.status >= 400 && error.status < 600 ? error.status : 502) as 400);
  logger.error('[Billing] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

/** Writes the audit row first and drops it when the change fails (the content router's rule). */
async function audited<T>(c: C, entry: Omit<AuditAction, 'actorId'>, run: () => Promise<T>, previousFrom?: (result: T) => Record<string, unknown> | null | undefined): Promise<T> {
  const db = c.env.REPORTS_DB;
  const auditId = await writeAudit(db, { ...entry, actorId: actorOf(c) });
  try {
    const result = await run();
    const previous = previousFrom?.(result);
    if (previous) await setAuditPrevious(db, auditId, previous).catch((e) => logger.warn('[Billing] Could not record the previous value', { auditId, error: String(e) }));
    return result;
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[Billing] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
}

function providerParam(c: C): PaymentProviderId {
  const id = c.req.param('id') ?? '';
  if (!Object.prototype.hasOwnProperty.call(PAYMENT_PROVIDERS, id)) throw new BadRequest('unknown_provider', 'No such payment provider');
  return id as PaymentProviderId;
}

// ---------------------------------------------------------------------------
// Overview and providers
// ---------------------------------------------------------------------------

app.get('/overview', async (c) => {
  need(c, 'billing:read');
  const [overview, credentialStorage] = await Promise.all([videos<Omit<AdminBillingOverview, 'credentialStorage'>>(c, '/overview'), credentialStorageReady(c.env)]);
  return ok(c, { ...overview, credentialStorage });
});

app.put('/providers/:id', async (c) => {
  need(c, 'billing:providers');
  const id = providerParam(c);
  const input = await body(c);
  const change = { enabled: input.enabled, mode: input.mode, settings: input.settings };
  return ok(
    c,
    await audited(
      c,
      { kind: 'billing-provider', id, action: 'update', details: change },
      () => videos<{ previous: { enabled: boolean; mode: string; settings: Record<string, string> }; provider: unknown }>(c, `/providers/${enc(id)}`, { method: 'PUT', json: change }),
      (r) => ({ enabled: r.previous.enabled, mode: r.previous.mode, settings: r.previous.settings }),
    ),
  );
});

/**
 * PUT /providers/:id/credentials { field, mode, value | null }: writes the value to Secrets Store
 * (null clears it), then records on api-videos that it is set. The audit row says which
 * credential changed and who changed it, never the value.
 */
app.put('/providers/:id/credentials', async (c) => {
  need(c, 'billing:providers');
  const provider = providerParam(c);
  if (provider === 'fake') throw new BadRequest('not_needed', 'The test provider has no credentials');
  const input = await body(c);
  const field = input.field as PaymentCredentialField;
  const mode = input.mode as PaymentMode;
  if (!(PAYMENT_CREDENTIAL_FIELDS as readonly string[]).includes(field)) throw new BadRequest('invalid_billing_request', 'field must be apiKey or webhookSecret');
  if (!(PAYMENT_MODES as readonly string[]).includes(mode)) throw new BadRequest('invalid_billing_request', 'mode must be test or live');
  const value = input.value === null ? null : typeof input.value === 'string' ? input.value.trim() : undefined;
  if (value === undefined || value === '') throw new BadRequest('invalid_billing_request', 'Enter the value, or send null to clear it');
  if (value !== null && (value.length > 500 || /\s/.test(value))) throw new BadRequest('invalid_billing_request', 'That does not look like a key: no spaces, at most 500 characters');
  const cleared = value === null;
  return ok(
    c,
    await audited(c, { kind: 'billing-provider', id: provider, action: cleared ? 'credential-clear' : 'credential-set', details: { field, mode } }, async () => {
      const written = await writeCredential(c.env, { provider, field, mode, value });
      const result = await videos(c, `/providers/${enc(provider)}/credentials`, { method: 'POST', json: { field, mode, cleared } });
      return { secretName: written.name, provider: result };
    }),
  );
});

app.post('/providers/:id/sync-prices', async (c) => {
  need(c, 'billing:providers');
  const id = providerParam(c);
  return ok(c, await audited(c, { kind: 'billing-provider', id, action: 'sync-prices' }, () => videos(c, `/providers/${enc(id)}/sync-prices`, { method: 'POST' })));
});

// ---------------------------------------------------------------------------
// Tax, prices, sale modes
// ---------------------------------------------------------------------------

app.put('/tax', async (c) => {
  need(c, 'billing:manage');
  const input = await body(c);
  return ok(c, await audited(c, { kind: 'billing-settings', id: 'tax', action: 'update', details: input }, () => videos<{ previous: Record<string, unknown> }>(c, '/tax', { method: 'PUT', json: input }), (r) => r.previous));
});

app.put('/prices', async (c) => {
  need(c, 'billing:manage');
  const input = await body(c);
  const key = `${String(input.tierId)}:${String(input.period)}:${String(input.currency).toUpperCase()}`;
  return ok(
    c,
    await audited(c, { kind: 'billing-price', id: key, action: 'save', details: input }, () => videos<{ previous: Record<string, unknown> | null }>(c, '/prices', { method: 'PUT', json: input }), (r) => r.previous ?? undefined),
  );
});

app.delete('/prices/:id', async (c) => {
  need(c, 'billing:manage');
  const id = c.req.param('id');
  return ok(c, await audited(c, { kind: 'billing-price', id, action: 'delete' }, () => videos<{ previous: Record<string, unknown> | null }>(c, `/prices/${enc(id)}`, { method: 'DELETE' }), (r) => r?.previous ?? undefined));
});


// ---------------------------------------------------------------------------
// Subscriptions, payments, comps
// ---------------------------------------------------------------------------

app.get('/subscriptions', async (c) => {
  need(c, 'billing:read');
  return ok(c, await videos(c, '/subscriptions', { query: c.req.query() }));
});

app.get('/subscriptions/:id', async (c) => {
  need(c, 'billing:read');
  return ok(c, await videos(c, `/subscriptions/${enc(c.req.param('id'))}`));
});

app.post('/subscriptions/:id/cancel', async (c) => {
  need(c, 'billing:manage');
  const id = c.req.param('id');
  const atPeriodEnd = (await body(c)).atPeriodEnd !== false;
  return ok(
    c,
    await audited(
      c,
      { kind: 'billing-subscription', id, action: atPeriodEnd ? 'cancel-at-period-end' : 'cancel-now', details: { atPeriodEnd } },
      () => videos<{ previous: { status: string; accessUntil: string | null } | null }>(c, `/subscriptions/${enc(id)}/cancel`, { method: 'POST', json: { atPeriodEnd } }),
      (r) => (r.previous ? { status: r.previous.status, accessUntil: r.previous.accessUntil } : undefined),
    ),
  );
});

app.post('/payments/:id/refund', async (c) => {
  need(c, 'billing:refund');
  const id = c.req.param('id');
  const input = await body(c);
  const amount = input.amount === null || input.amount === undefined ? null : input.amount;
  return ok(c, await audited(c, { kind: 'billing-payment', id, action: 'refund', details: { amount, reason: input.reason } }, () => videos(c, `/payments/${enc(id)}/refund`, { method: 'POST', json: { amount, reason: input.reason } })));
});

app.post('/comps', async (c) => {
  need(c, 'billing:manage');
  const input = await body(c);
  const userId = typeof input.userId === 'string' ? input.userId : '';
  return ok(c, await audited(c, { kind: 'user', id: userId, action: 'billing-comp', details: { tierId: input.tierId, until: input.until ?? null, reason: input.reason } }, () => videos(c, '/comps', { method: 'POST', json: input })));
});

app.get('/users/:id', async (c) => {
  need(c, 'billing:read');
  return ok(c, await videos(c, `/users/${enc(c.req.param('id'))}`));
});

export default app;
