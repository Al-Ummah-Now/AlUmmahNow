/**
 * #442: "Sign out this device" ends the install's sign-in at auth through the
 * auth-moderation-requests queue: retried with backoff, a final failure (or the DLQ)
 * is audited as needing attention and flagged on the Errors page with Retry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthApiError, AuthModerationClient } from '../src/lib/authModeration';
import {
  MAX_ATTEMPTS,
  deadLetterDeviceRevocation,
  deviceRevocationItemKey,
  enqueueDeviceRevocation,
  isDeviceRevocationMessage,
  processDeviceRevocation,
  type DeviceRevocationMessage,
} from '../src/lib/deviceTokenRevocation';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';
import { sqliteD1 } from './d1-sqlite';

const MSG: DeviceRevocationMessage = { type: 'revoke-install', userId: 'usr_1', installId: 'ins_1', actorId: 'admin-1' };

function envWith(queue?: { send(body: unknown): Promise<void> }) {
  return { REPORTS_DB: sqliteD1(), AUTH_REQUESTS_QUEUE: queue, ENVIRONMENT: 'qa' } as never;
}

async function audits(env: any) {
  const { results } = await env.REPORTS_DB.prepare('SELECT action, target_id, metadata FROM admin_audit_log ORDER BY created_at').all();
  return (results as any[]).map((r) => ({ action: r.action, target: r.target_id, meta: JSON.parse(r.metadata) }));
}

const failing = (error: unknown) => ({ async revokeInstallTokens() { throw error; } });

describe('device token revocation', () => {
  it('calls auth with the install and audits the success', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new AuthModerationClient({
      authUrl: 'https://auth.test',
      clientId: 'mod-client',
      clientSecret: 's3cret',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    const env = envWith();
    assert.equal(await processDeviceRevocation(env, MSG, 1, client), 'done');
    assert.equal(calls[0].url, 'https://auth.test/internal/token-revocations');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(new Headers(calls[0].init.headers).get('Authorization'), `Basic ${btoa('mod-client:s3cret')}`);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { user_id: 'usr_1', install_id: 'ins_1' });
    assert.deepEqual((await audits(env)).map((a) => a.action), ['staff_device_tokens_revoked']);
  });

  it('retries a transient failure, then flags it once retries run out', async () => {
    const env = envWith();
    const down = failing(new AuthApiError(502, 'auth_unreachable', 'down'));
    assert.equal(await processDeviceRevocation(env, MSG, 1, down), 'retry');
    assert.deepEqual(await audits(env), []);
    assert.equal(await processDeviceRevocation(env, MSG, MAX_ATTEMPTS, down), 'failed');
    const [flag] = await audits(env);
    assert.equal(flag.action, 'staff_device_tokens_revoke_failed');
    assert.equal(flag.meta.needsAttention, true);
    assert.equal(flag.meta.installId, 'ins_1');
  });

  it('a permanent error is flagged at once; a user auth does not know has nothing to revoke', async () => {
    const env = envWith();
    assert.equal(await processDeviceRevocation(env, MSG, 1, failing(new AuthApiError(400, 'invalid_request', 'bad'))), 'failed');
    assert.equal((await audits(env))[0].action, 'staff_device_tokens_revoke_failed');
    const other = envWith();
    assert.equal(await processDeviceRevocation(other, MSG, 1, failing(new AuthApiError(404, 'not_found', 'gone'))), 'done');
    assert.equal((await audits(other))[0].action, 'staff_device_tokens_revoked');
  });

  it('the DLQ and a queue that is not configured flag the failure', async () => {
    const env = envWith();
    await deadLetterDeviceRevocation(env, MSG);
    assert.equal(await enqueueDeviceRevocation(env, MSG), false);
    assert.deepEqual((await audits(env)).map((a) => a.action), ['staff_device_tokens_revoke_failed', 'staff_device_tokens_revoke_failed']);
  });

  it('Retry on the Errors page queues it again', async () => {
    const sent: unknown[] = [];
    const env = envWith({ async send(body) { sent.push(body); } });
    const out = await BUILTIN_RETRIES['device-tokens'](env, { userId: 'usr_1', installId: 'ins_1', actorId: 'admin-1' }, '1');
    assert.deepEqual(out, { ok: true, status: 'resolved', result: 'Queued again' });
    assert.deepEqual(sent, [MSG]);
    assert.equal((await BUILTIN_RETRIES['device-tokens'](env, {}, '1')).ok, false);
  });

  it('recognises its messages and keys the Errors item per install', () => {
    assert.equal(isDeviceRevocationMessage(MSG), true);
    assert.equal(isDeviceRevocationMessage({ type: 'send', id: 'x' }), false);
    assert.equal(deviceRevocationItemKey(MSG), 'device-tokens:usr_1:ins_1');
  });
});

describe('the auth-moderation-requests consumer', () => {
  it('runs device revocations, retries transient failures and flags them from the DLQ', async () => {
    const { handleAuthRequestBatch } = await import('../src/lib/authModerationQueue');
    const run = async (queue: string, client: unknown, attempts = 1) => {
      const seen = { acked: false, retried: false };
      const env = envWith();
      await handleAuthRequestBatch(
        { queue, messages: [{ body: MSG, attempts, ack() { seen.acked = true; }, retry() { seen.retried = true; } }] } as never,
        env as never,
        client as never
      );
      return { ...seen, actions: (await audits(env)).map((a) => a.action) };
    };
    assert.deepEqual(await run('auth-moderation-requests-qa', { async revokeInstallTokens() {} }), { acked: true, retried: false, actions: ['staff_device_tokens_revoked'] });
    assert.deepEqual(await run('auth-moderation-requests-qa', failing(new AuthApiError(502, 'auth_unreachable', 'down'))), { acked: false, retried: true, actions: [] });
    assert.deepEqual(await run('auth-moderation-requests-dlq-qa', failing(new Error('unused'))), { acked: true, retried: false, actions: ['staff_device_tokens_revoke_failed'] });
  });
});
