import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthApiError,
  AuthModerationClient,
  SubmitSchema,
  buildEvidence,
  composeReason,
  isFinalStatus,
  reportsOnUserContent,
  syncMirror,
  type AuthRequest,
  type MirrorRow,
} from '../src/lib/authModeration';
import { canRequestAuthAction, hasPermission } from '../src/lib/roles';

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
  created_at: '2026-11-09T00:00:00.000Z',
  updated_at: '2026-11-09T00:00:00.000Z',
  history: [],
  ...over,
});

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const client = (f: typeof fetch) => new AuthModerationClient({ authUrl: 'https://auth.qa.alummahnow.net', clientId: 'cid', clientSecret: { get: async () => 's3cret' }, fetch: f });

describe('auth moderation requests: validation', () => {
  const valid = { subject_user_id: 'usr_abc', action: 'suspend_account', reason_category: 'harassment', reason: 'Abuse in comments' };
  it('accepts a minimal request', () => {
    assert.equal(SubmitSchema.safeParse(valid).success, true);
  });
  for (const [name, over] of [
    ['an unknown action', { action: 'ban' }],
    ['an unknown reason', { reason_category: 'rude' }],
    ['an empty reason', { reason: '  ' }],
    ['a bad user id', { subject_user_id: 'usr 1' }],
    ['a javascript: evidence link', { evidence: [{ url: 'javascript:alert(1)' }] }],
  ] as const) {
    it(`rejects ${name}`, () => assert.equal(SubmitSchema.safeParse({ ...valid, ...over }).success, false));
  }
  it('videos admin RBAC: moderators read, admins and super admins send', () => {
    for (const roles of [['Admin'], ['Super Admin'], ['Moderator']]) assert.equal(hasPermission(roles, 'auth_requests:read'), true, String(roles));
    for (const roles of [['User'], []]) assert.equal(hasPermission(roles, 'auth_requests:read'), false, String(roles));
    for (const roles of [['Admin'], ['Super Admin']]) assert.equal(hasPermission(roles, 'auth_requests:send'), true, String(roles));
    for (const roles of [['Moderator'], ['User'], []]) assert.equal(hasPermission(roles, 'auth_requests:send'), false, String(roles));
  });
  it('only admins and super admins may send', () => {
    assert.equal(canRequestAuthAction(['Admin']), true);
    assert.equal(canRequestAuthAction(['Super Admin']), true);
    assert.equal(canRequestAuthAction(['Moderator']), false);
    assert.equal(canRequestAuthAction([]), false);
  });
  it('final statuses', () => {
    assert.deepEqual(['pending', 'info_requested', 'approved', 'rejected', 'actioned'].filter(isFinalStatus), ['rejected', 'actioned']);
  });
});

describe('auth moderation requests: evidence', () => {
  it('attaches the user page, reports, then extras, without duplicates', () => {
    const e = buildEvidence({
      adminWebUrl: 'https://admin.qa.alummahnow.net/',
      subjectUserId: 'usr_1',
      reportIds: ['rep_1'],
      extra: [{ url: 'https://admin.qa.alummahnow.net/users/usr_1' }, { url: 'https://example.com/x', label: 'x' }],
    });
    assert.deepEqual(e.map((x) => x.url), [
      'https://admin.qa.alummahnow.net/users/usr_1',
      'https://admin.qa.alummahnow.net/moderation/reports/rep_1',
      'https://example.com/x',
    ]);
  });
  it('caps at 20 links', () => {
    assert.equal(buildEvidence({ adminWebUrl: 'https://a.example', subjectUserId: 'u', reportIds: Array.from({ length: 30 }, (_, i) => `r${i}`) }).length, 20);
  });
  it('adds the note to the reason', () => {
    assert.equal(composeReason('Spam', 'see reports'), 'Spam\n\nNote: see reports');
    assert.equal(composeReason('Spam'), 'Spam');
  });
  it('finds reports on content the user owns', async () => {
    const search = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ kind: 'video', id: 'v1' }, { kind: 'post', id: 'p1' }] }) }) }) };
    let bound: unknown[] = [];
    const reports = {
      prepare: () => ({
        bind: (...args: unknown[]) => {
          bound = args;
          return { all: async () => ({ results: [{ id: 'rep_1', entity_type: 'video', entity_id: 'v1', reason: 'spam', status: 'pending', created_at: '2026-11-01' }] }) };
        },
      }),
    };
    const found = await reportsOnUserContent(reports as never, search as never, 'usr_1');
    assert.deepEqual(found, [{ id: 'rep_1', entity_type: 'video', entity_id: 'v1', reason: 'spam', status: 'pending' }]);
    assert.deepEqual(bound, ['video', 'v1', 'post', 'p1', 10]);
    assert.deepEqual(await reportsOnUserContent(undefined, search as never, 'usr_1'), []);
  });
});

describe('auth moderation requests: auth client', () => {
  it('authenticates as the client and sends the idempotency key', async () => {
    const f = fakeFetch([{ status: 201, body: { request: authRequest() } }]);
    const { request, replayed } = await client(f.impl).create(
      { subject_user_id: 'usr_1', action: 'revoke_sessions', reason_category: 'spam', reason: 'r', evidence: [], requested_by: { id: 'a1', display_name: 'Admin' } },
      'key-12345678'
    );
    assert.equal(request.id, 'modreq_1');
    assert.equal(replayed, false);
    assert.equal(f.calls[0].url, 'https://auth.qa.alummahnow.net/moderation/requests');
    const headers = f.calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Basic ${btoa('cid:s3cret')}`);
    assert.equal(headers['Idempotency-Key'], 'key-12345678');
  });
  it('a 200 answer is a replay', async () => {
    const f = fakeFetch([{ status: 200, body: { request: authRequest() } }]);
    const { replayed } = await client(f.impl).create({ subject_user_id: 'usr_1', action: 'other', reason_category: 'other', reason: 'r', evidence: [], requested_by: { id: 'a', display_name: 'A' } }, 'key-12345678');
    assert.equal(replayed, true);
  });
  it('auth refusing our credentials is a 502, a missing user stays 404', async () => {
    const f = fakeFetch([
      { status: 401, body: { error: 'invalid_client', error_description: 'bad secret' } },
      { status: 404, body: { error: 'subject_not_found', error_description: 'No auth user has this id' } },
    ]);
    await assert.rejects(client(f.impl).get('modreq_1'), (e: AuthApiError) => e.status === 502 && e.code === 'invalid_client');
    await assert.rejects(client(f.impl).get('modreq_1'), (e: AuthApiError) => e.status === 404 && e.code === 'subject_not_found');
  });
  it('is not configured without a secret', () => {
    assert.throws(() => AuthModerationClient.fromEnv({ Issuer: 'https://auth.example', AUTH_MODERATION_CLIENT_ID: 'cid' }), (e: AuthApiError) => e.status === 503);
  });
});

describe('auth moderation requests: mirror', () => {
  it('reports a status change from auth', async () => {
    const runs: unknown[][] = [];
    const db = { prepare: () => ({ bind: (...a: unknown[]) => ({ run: async () => { runs.push(a); return {}; } }) }) };
    const row = { id: 'modreq_1', status: 'pending', subject_user_id: 'usr_1' } as MirrorRow;
    assert.equal(await syncMirror(db as never, row, authRequest({ status: 'actioned', decision_note: 'done' })), true);
    assert.equal(runs[0][0], 'actioned');
    assert.equal(runs[0][1], 'done');
    assert.equal(await syncMirror(db as never, row, authRequest({ status: 'pending' })), false);
  });
});
