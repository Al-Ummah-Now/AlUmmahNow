/**
 * Requests to auth go through the auth-moderation-requests queue
 * (docs/admin/AUTH_MODERATION_REQUESTS.md): send with retries, flag on failure,
 * status reads, answers, the dead-letter queue. Runs migration 0011 on SQLite.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './d1-sqlite';
import { AuthApiError, AuthModerationClient, getRow, insertSending, type AuthRequest } from '../src/lib/authModeration';
import {
  MAX_ATTEMPTS,
  enqueueSend,
  enqueueSyncs,
  handleAuthRequestBatch,
  isDeadLetterQueue,
  processInfo,
  processSend,
  processSync,
  retryDelaySeconds,
  scheduleSyncs,
  type AuthRequestMessage,
  type QueueEnv,
} from '../src/lib/authModerationQueue';

const authRequest = (over: Partial<AuthRequest> = {}): AuthRequest => ({
  id: 'modreq_1',
  status: 'pending',
  subject_user_id: 'usr_1',
  action: 'revoke_sessions',
  reason_category: 'spam',
  reason: 'r',
  evidence: [],
  requested_by: { id: 'a1', display_name: 'Admin' },
  decision_note: null,
  decided_at: null,
  actioned_at: null,
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
  history: [],
  ...over,
});

/** A fake auth client: each call takes the next scripted answer (an AuthRequest or an error). */
function fakeClient(script: Array<AuthRequest | Error>) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const next = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    const answer = script.shift();
    if (!answer) throw new Error('no scripted answer');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const client = {
    create: async (payload: unknown, key: string) => ({ request: next('create', [payload, key]), replayed: false }),
    get: async (id: string) => next('get', [id]),
    provideInfo: async (id: string, body: unknown) => next('info', [id, body]),
  } as unknown as AuthModerationClient;
  return { client, calls };
}

function fakeQueue() {
  const sent: AuthRequestMessage[] = [];
  return {
    sent,
    queue: {
      send: async (m: AuthRequestMessage) => void sent.push(m),
      sendBatch: async (ms: Array<{ body: AuthRequestMessage }>) => void sent.push(...ms.map((m) => m.body)),
    } as unknown as Queue<AuthRequestMessage>,
  };
}

let env: QueueEnv;
let q: ReturnType<typeof fakeQueue>;

async function newRequest(id = 'areq_1', key = 'key-0001') {
  await insertSending(env.REPORTS_DB as never, {
    id,
    subject_user_id: 'usr_1',
    action: 'revoke_sessions',
    reason_category: 'spam',
    reason: 'Spam links',
    evidence: [{ url: 'https://admin.qa.alummahnow.net/users/usr_1' }],
    requested_by_id: 'a1',
    requested_by_name: 'Admin',
    idempotency_key: key,
  });
  return id;
}
const row = (id = 'areq_1') => getRow(env.REPORTS_DB as never, id).then((r) => r!);
const auditActions = async () => ((await env.REPORTS_DB.prepare('SELECT action FROM admin_audit_log ORDER BY rowid').all<{ action: string }>()).results ?? []).map((r) => r.action);

beforeEach(() => {
  q = fakeQueue();
  env = { REPORTS_DB: sqliteD1() as never, AUTH_REQUESTS_QUEUE: q.queue };
});

describe('sending a request to auth', () => {
  it('recognises the dead-letter queues of every env', () => {
    assert.deepEqual(['auth-moderation-requests-dlq', 'auth-moderation-requests-dlq-stage', 'auth-moderation-requests-dlq-qa', 'auth-moderation-requests-qa'].map(isDeadLetterQueue), [true, true, true, false]);
  });

  it('backs off 30 s doubling, capped at 15 minutes', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(retryDelaySeconds), [30, 60, 120, 240, 480, 900, 900]);
  });

  it('queues the send; a delivery marks it sent with auth\'s id and status', async () => {
    const id = await newRequest();
    assert.equal(await enqueueSend(env, await row(), 'a1'), true);
    assert.deepEqual(q.sent, [{ type: 'send', id }]);
    const { client, calls } = fakeClient([authRequest({ id: 'modreq_9' })]);
    assert.equal(await processSend(env, id, 1, client), 'done');
    assert.equal(calls[0].args[1], 'key-0001', 'the idempotency key goes with every attempt');
    assert.deepEqual((calls[0].args[0] as { requested_by: unknown }).requested_by, { id: 'a1', display_name: 'Admin' });
    const r = await row();
    assert.equal(r.delivery_status, 'sent');
    assert.equal(r.auth_request_id, 'modreq_9');
    assert.equal(r.status, 'pending');
    assert.deepEqual(await auditActions(), ['auth_request.sent']);
    // A duplicate delivery does nothing
    assert.equal(await processSend(env, id, 2, fakeClient([]).client), 'skipped');
  });

  it('transient errors retry (same key), the last attempt flags the request', async () => {
    const id = await newRequest();
    const { client, calls } = fakeClient([new AuthApiError(502, 'auth_unreachable', 'down'), new AuthApiError(429, 'rate_limit_exceeded', 'slow down')]);
    assert.equal(await processSend(env, id, 1, client), 'retry');
    let r = await row();
    assert.equal(r.delivery_status, 'sending');
    assert.equal(r.delivery_attempts, 1);
    assert.match(r.delivery_error!, /down/);
    assert.equal(await processSend(env, id, MAX_ATTEMPTS, client), 'failed');
    r = await row();
    assert.equal(r.delivery_status, 'failed');
    assert.match(r.delivery_error!, /rate_limit/);
    assert.equal(calls.every((c) => c.args[1] === 'key-0001'), true);
    assert.deepEqual(await auditActions(), ['auth_request.failed']);
  });

  it('a permanent error (auth has no such user) flags at once', async () => {
    const id = await newRequest();
    const { client } = fakeClient([new AuthApiError(404, 'subject_not_found', 'No auth user has this id')]);
    assert.equal(await processSend(env, id, 1, client), 'failed');
    assert.equal((await row()).delivery_status, 'failed');
  });

  it('without a queue the request is flagged instead of lost', async () => {
    const id = await newRequest();
    env.AUTH_REQUESTS_QUEUE = undefined;
    assert.equal(await enqueueSend(env, await row(), 'a1'), false);
    const r = await row();
    assert.equal(r.delivery_status, 'failed');
    assert.match(r.delivery_error!, /not configured/);
    assert.equal(id, r.id);
  });
});

describe('status reads', () => {
  async function sent(id = 'areq_1', key = 'key-0001', authId = 'modreq_1') {
    await newRequest(id, key);
    await processSend(env, id, 1, fakeClient([authRequest({ id: authId })]).client);
  }

  it('reads auth\'s status into the mirror and audits a change', async () => {
    await sent();
    const { client, calls } = fakeClient([authRequest({ status: 'actioned', decision_note: 'Signed out everywhere' })]);
    assert.equal(await processSync(env, 'areq_1', 1, client), 'done');
    assert.deepEqual(calls[0].args, ['modreq_1']);
    const r = await row();
    assert.equal(r.status, 'actioned');
    assert.equal(r.decision_note, 'Signed out everywhere');
    assert.deepEqual(await auditActions(), ['auth_request.sent', 'auth_request.actioned']);
    // Final: no more reads
    assert.equal(await processSync(env, 'areq_1', 1, fakeClient([]).client), 'skipped');
  });

  it('queues reads only for sent, open requests, at most every 30 s', async () => {
    await sent('areq_1', 'key-0001', 'modreq_1');
    await newRequest('areq_2', 'key-0002'); // still sending
    // The send stored auth's status; the cron reads a young request again from its next run (5 min)
    assert.equal(await scheduleSyncs(env, Date.now()), 0);
    const now = Date.now() + 5 * 60_000;
    assert.equal(await scheduleSyncs(env, now), 1);
    assert.deepEqual(q.sent, [{ type: 'sync', id: 'areq_1' }]);
    assert.equal(await enqueueSyncs(env, [await row('areq_1')], now + 10_000), 0, 'throttled');
    assert.equal(await enqueueSyncs(env, [await row('areq_1')], now + 31_000), 1);
  });

  it('a read failing after its retries leaves a sync error', async () => {
    await sent();
    const { client } = fakeClient([new AuthApiError(502, 'auth_unreachable', 'down'), new AuthApiError(502, 'auth_unreachable', 'down')]);
    assert.equal(await processSync(env, 'areq_1', 1, client), 'retry');
    assert.equal(await processSync(env, 'areq_1', MAX_ATTEMPTS, client), 'failed');
    assert.match((await row()).sync_error!, /down/);
  });
});

describe('answers and the dead-letter queue', () => {
  it('delivers a queued answer and clears it', async () => {
    await newRequest();
    await processSend(env, 'areq_1', 1, fakeClient([authRequest({ status: 'info_requested' })]).client);
    await env.REPORTS_DB.prepare("UPDATE auth_moderation_requests SET pending_info = ? WHERE id = 'areq_1'")
      .bind(JSON.stringify({ note: 'Two more reports', evidence: [], requested_by: { id: 'a1', display_name: 'Admin' } }))
      .run();
    const { client, calls } = fakeClient([authRequest({ status: 'pending' })]);
    assert.equal(await processInfo(env, 'areq_1', 1, client), 'done');
    assert.equal(calls[0].op, 'info');
    const r = await row();
    assert.equal(r.pending_info, null);
    assert.equal(r.status, 'pending');
  });

  it('the batch handler acks, retries with backoff and flags from the DLQ', async () => {
    await newRequest('areq_1', 'key-0001');
    await newRequest('areq_2', 'key-0002');
    const msgs = (queue: string, bodies: AuthRequestMessage[], attempts: number) => {
      const list = bodies.map((body) => ({ body, attempts, acked: false, retried: undefined as unknown, ack() { this.acked = true; }, retry(o: unknown) { this.retried = o; } }));
      return { batch: { queue, messages: list } as unknown as MessageBatch<AuthRequestMessage>, list };
    };
    const { client } = fakeClient([authRequest({ id: 'modreq_1' }), new AuthApiError(502, 'auth_unreachable', 'down')]);
    const a = msgs('auth-moderation-requests-qa', [{ type: 'send', id: 'areq_1' }, { type: 'send', id: 'areq_2' }], 3);
    await handleAuthRequestBatch(a.batch, env, client);
    assert.equal(a.list[0].acked, true);
    assert.deepEqual(a.list[1].retried, { delaySeconds: 120 });
    const d = msgs('auth-moderation-requests-dlq-qa', [{ type: 'send', id: 'areq_2' }], 1);
    await handleAuthRequestBatch(d.batch, env, fakeClient([]).client);
    assert.equal(d.list[0].acked, true);
    assert.equal((await row('areq_2')).delivery_status, 'failed');
    const bad = msgs('auth-moderation-requests-qa', [{ type: 'nope' } as never], 1);
    await handleAuthRequestBatch(bad.batch, env, fakeClient([]).client);
    assert.equal(bad.list[0].acked, true);
  });
});

describe('background reads are paced (cost: QA E2E leftovers were read every 5 minutes, forever)', () => {
  const HOUR = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  async function openRequest(id: string, key: string, createdAt: number, syncedAt: number | null) {
    await newRequest(id, key);
    await processSend(env, id, 1, fakeClient([authRequest({ id: `mod_${id}` })]).client);
    await env.REPORTS_DB.prepare('UPDATE auth_moderation_requests SET created_at = ?, synced_at = ?, sync_requested_at = NULL WHERE id = ?')
      .bind(iso(createdAt), syncedAt === null ? null : iso(syncedAt), id)
      .run();
  }

  it('the cron reads a young request every run, older ones every 30 min, 3 h, then daily', async () => {
    const now = Date.now();
    await openRequest('young', 'key-0001', now - 20 * 60_000, now - 5 * 60_000); // 20 min old, read 5 min ago: due
    await openRequest('day', 'key-0002', now - 5 * HOUR, now - 10 * 60_000); // 5 h old, read 10 min ago: not due (30 min)
    await openRequest('week', 'key-0003', now - 3 * 24 * HOUR, now - 2 * HOUR); // 3 days old, read 2 h ago: not due (3 h)
    await openRequest('old', 'key-0004', now - 30 * 24 * HOUR, now - 23 * HOUR); // a month old, read 23 h ago: not due (daily)
    await openRequest('stale', 'key-0005', now - 30 * 24 * HOUR, now - 25 * HOUR); // read 25 h ago: due
    await openRequest('never', 'key-0006', now - 30 * 24 * HOUR, null); // never read: due
    assert.equal(await scheduleSyncs(env, now), 3);
    assert.deepEqual(q.sent.map((m) => m.id).sort(), ['never', 'stale', 'young']);
  });

  it('an admin opening a request still reads it at once, whatever its age', async () => {
    const now = Date.now();
    await openRequest('old', 'key-0001', now - 30 * 24 * HOUR, now - HOUR);
    assert.equal(await scheduleSyncs(env, now), 0);
    assert.equal(await enqueueSyncs(env, [await row('old')], now), 1);
  });

  it('a read that finds nothing new writes only the read time', async () => {
    await newRequest();
    await processSend(env, 'areq_1', 1, fakeClient([authRequest()]).client);
    await processSync(env, 'areq_1', 1, fakeClient([authRequest()]).client);
    const before = await row();
    await env.REPORTS_DB.prepare("UPDATE auth_moderation_requests SET sync_error = 'old error' WHERE id = 'areq_1'").run();
    assert.equal(await processSync(env, 'areq_1', 1, fakeClient([authRequest()]).client), 'done');
    const after = await row();
    assert.equal(after.updated_at, before.updated_at, 'row untouched');
    assert.equal(after.sync_error, null, 'a stale sync error is cleared');
    assert.ok(after.synced_at && after.synced_at >= before.synced_at!);
    // A change still lands in full
    await processSync(env, 'areq_1', 1, fakeClient([authRequest({ status: 'info_requested', decision_note: 'More please' })]).client);
    assert.equal((await row()).status, 'info_requested');
    assert.equal((await row()).decision_note, 'More please');
  });
});
