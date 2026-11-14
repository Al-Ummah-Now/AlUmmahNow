import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createErrorReporter,
  errorRefFromDigest,
  fingerprint,
  isVersionSkewError,
  stableFile,
  parseUserAgent,
  newErrorRef,
  normalizeMessage,
  normalizeRoute,
  parseErrorRef,
  parseStack,
  postReport,
  reportNeedsAction,
  reportServerError,
  resetServerReporterState,
  resolveNeedsAction,
  scrubEvent,
  scrubStack,
  scrubText,
  scrubUrl,
  topFrames,
  withErrorReporting,
  type ErrorEventInput,
} from '@al-ummah/shared-types';
import { hasPermission, permissionsFor } from '../src/lib/roles';
import {
  ERROR_RATE_LIMITS,
  ERROR_SAMPLE_LIMITS,
  addErrorNote,
  allowClientEvents,
  deleteTestGroupByRef,
  errorCounts,
  findByRef,
  getActionItem,
  getErrorGroup,
  groupIdFor,
  ingestErrorEvents,
  listErrorGroups,
  listGroupActions,
  listGroupActivity,
  listGroupEvents,
  openActionCount,
  pruneErrorData,
  recordActionAttempt,
  resolveActionItems,
  setErrorAssignee,
  setErrorStatus,
} from '../src/lib/errors-store';
import { alertRecipient, isAlertWorthy, renderErrorAlert, sendErrorAlerts, ERROR_ALERT_LIMITS } from '../src/lib/errors-alerts';
import { consumeErrorQueue, enqueueIngest, retryDelaySeconds, type ErrorIngestMessage } from '../src/endpoints/errors/ErrorsIngest';
import { runRetry, SERVICE_RETRIES } from '../src/lib/errors-actions';
import { contactMailItemKey, reportContactMailFailure } from '../src/lib/contact-mail-queue';
import { deliveryStatus, insertContactMessage, recordDelivery } from '../src/lib/contact-store';
import { ParsedSourceMap, decodeVlq, sourceMapKey, symbolicateFrames, clearSourceMapCache } from '../src/lib/sourcemaps';
import { pruneSourceMaps } from '../src/lib/errors-retention';
import { sqliteD1 } from './d1-sqlite';

const NOW = new Date('2026-11-09T12:30:00.000Z');
const ctx = (over: Partial<Parameters<typeof ingestErrorEvents>[2]> = {}) => ({ now: NOW, environment: 'production', random: () => 0.99, ...over });

function ev(over: Partial<ErrorEventInput> = {}): ErrorEventInput {
  return scrubEvent({
    app: 'web',
    kind: 'unhandled',
    ref: newErrorRef(),
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'title')",
    stack: "TypeError: x\n    at VideoCard (https://videos.alummahnow.net/_next/static/chunks/app/page-3f2a9c1b2c3d4e5f.js:1:200)",
    route: '/en/video/aB3dEf9hiJ',
    release: 'rel1',
    occurredAt: NOW.toISOString(),
    ...over,
  })!;
}

describe('scrubbing', () => {
  it('removes emails, tokens, secrets and IPs from text', () => {
    const s = scrubText('user a.b@example.org Bearer abcdefghijklmnop token=xyz123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlMTIz from 10.1.2.3 cb?code=OAUTH&state=s1 code: 500');
    assert.doesNotMatch(s, /example\.org|abcdefghijklmnop|xyz123|eyJ|10\.1\.2\.3|OAUTH|s1\b/);
    assert.match(s, /\[email\]/);
    assert.match(s, /code: 500/); // an error code in prose is kept
  });

  it('keeps only safe query parameters and drops the origin and fragment', () => {
    assert.equal(scrubUrl('https://videos.alummahnow.net/en/watch?v=abc&token=t&email=a@b.co&page=2#x'), '/en/watch?v=abc&page=2');
  });

  it('strips query strings from stack frame URLs', () => {
    assert.doesNotMatch(scrubStack('at f (https://x.net/a.js?token=secret:1:2)'), /secret/);
  });

  it('validates events: unknown app/kind, bad reference or empty message are refused', () => {
    assert.equal(scrubEvent({ app: 'cms', kind: 'unhandled', ref: newErrorRef(), message: 'x' }), null);
    // The sign-in server (AlUmmahNowAuth#341) reports as 'auth'
    assert.equal(scrubEvent({ app: 'auth', kind: 'unhandled', ref: newErrorRef(), message: 'x' })?.app, 'auth');
    assert.equal(scrubEvent({ app: 'web', kind: 'nope', ref: newErrorRef(), message: 'x' }), null);
    assert.equal(scrubEvent({ app: 'web', kind: 'unhandled', ref: 'ERR-1', message: 'x' }), null);
    assert.equal(scrubEvent({ app: 'web', kind: 'unhandled', ref: newErrorRef(), message: '' }), null);
  });

  it('keeps only usr_ account ids and drops anything else that identifies a person', () => {
    assert.equal(ev({ userId: 'usr_abc12345' }).userId, 'usr_abc12345');
    assert.equal(scrubEvent({ ...ev(), userId: 'someone@example.org' })!.userId, undefined);
  });

  it('accepts needs-action items with an allowlisted link and drops foreign links', () => {
    const e = scrubEvent({ app: 'processor', kind: 'action', ref: newErrorRef(), message: 'boom', action: { key: 'dlq:m1', source: 'dlq', title: 'Dead letter', itemUrl: 'https://evil.example/x', retry: { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id: 'm1' } } } })!;
    assert.equal(e.action?.itemUrl, undefined);
    assert.deepEqual(e.action?.retry, { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id: 'm1' } });
    assert.equal(scrubEvent({ app: 'processor', kind: 'action', ref: newErrorRef(), message: 'x' }), null, 'an action needs its item');
    assert.equal(scrubEvent({ app: 'web', kind: 'action', ref: newErrorRef(), action: { key: 'k', source: 'email', title: 'T', itemUrl: '/contact/1' } })!.action?.itemUrl, '/contact/1');
    for (const bad of ['//evil.example/x', '/\\evil.example', '/\\/evil', 'javascript:alert(1)', 'https://alummahnow.net.evil.example/']) {
      assert.equal(scrubEvent({ app: 'web', kind: 'action', ref: newErrorRef(), action: { key: 'k', source: 'email', title: 'T', itemUrl: bad } })!.action?.itemUrl, undefined, bad);
    }
  });
});

describe('fingerprinting', () => {
  it('normalises ids, numbers, quoted values and URLs out of messages', () => {
    assert.equal(normalizeMessage('Video abc123def not found (42) at https://x.net/a "q"'), 'Video <id> not found (<n>) at <url> <str>');
  });

  it('normalises routes: locale and id segments', () => {
    assert.equal(normalizeRoute('/ar/video/aB3dEf9hiJ?v=1'), '/:locale/video/:id');
    assert.equal(normalizeRoute('/en/c/@channel/videos'), '/:locale/c/:id/videos');
    assert.equal(normalizeRoute('/api/videos/123/comments'), '/api/videos/:id/comments');
  });

  it('ignores build hashes and minified names in frames', () => {
    const frames = parseStack('E\n    at Hx (https://v.net/_next/static/chunks/app/page-3f2a9c1b2c3d4e5f.js:1:2)\n    at render@https://v.net/_next/static/chunks/main-0123456789abcdef.js:3:4');
    assert.deepEqual(topFrames(frames), ['@chunks/app/page.js', 'render@static/chunks/main.js']);
  });

  it('groups the same error on different ids and builds, separates different errors', () => {
    const a = fingerprint({ app: 'web', name: 'TypeError', message: 'Video abc123 missing', route: '/en/video/x1y2z3a4b5' });
    const b = fingerprint({ app: 'web', name: 'TypeError', message: 'Video zz99yy missing', route: '/ar/video/q9w8e7r6t5' });
    const c = fingerprint({ app: 'web', name: 'TypeError', message: 'Channel abc123 missing', route: '/en/video/x1y2z3a4b5' });
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.notEqual(a, fingerprint({ app: 'admin-web', name: 'TypeError', message: 'Video abc123 missing', route: '/en/video/x1y2z3a4b5' }));
  });
});

describe('references', () => {
  it('are ERR-XXXX-XXXX, derived identically from a digest, and parse loosely', () => {
    assert.match(newErrorRef(), /^ERR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(errorRefFromDigest('3012345678'), errorRefFromDigest('3012345678'));
    assert.notEqual(errorRefFromDigest('1'), errorRefFromDigest('2'));
    assert.equal(parseErrorRef('err 3k9f 2b7q'), 'ERR-3K9F-2B7Q');
    assert.equal(parseErrorRef('ERR-3K9F-2B7O'), 'ERR-3K9F-2B70');
    assert.equal(parseErrorRef('hello'), null);
  });

  it('recognises the owner\'s version-skew message', () => {
    assert.equal(isVersionSkewError(new Error('Server Action "7f3a" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action')), true);
  });
});

describe('ingest and grouping', () => {
  let db: D1Database;
  beforeEach(() => {
    db = sqliteD1();
  });

  it('folds repeats into one group with counts per release, hour and user', async () => {
    const out1 = await ingestErrorEvents(db, [ev({ userId: 'usr_aaaa1111' }), ev({ userId: 'usr_aaaa1111', route: '/ar/video/zZ9yX8wV7u' })], ctx());
    const out2 = await ingestErrorEvents(db, [ev({ userId: 'usr_bbbb2222', release: 'rel2', count: 3 })], ctx());
    assert.equal(out1.created.length, 1);
    assert.equal(out2.created.length, 0);
    const [g] = (await listErrorGroups(db, { limit: 10, offset: 0 }, NOW)).groups;
    assert.equal(g.occurrences, 5);
    assert.equal(g.users, 2);
    assert.equal(g.first_release, 'rel1');
    assert.equal(g.last_release, 'rel2');
    assert.equal(g.route, '/:locale/video/:id');
    assert.equal(g.daily.at(-1), 5);
    assert.equal(g.daily.length, 14);
  });

  it('finds a group by any reference, even after its sample was trimmed', async () => {
    const shown = ev({ shown: true });
    await ingestErrorEvents(db, [shown], ctx());
    const hit = await findByRef(db, shown.ref);
    assert.ok(hit?.event_id);
    const byQuery = await listErrorGroups(db, { q: shown.ref, limit: 10, offset: 0 });
    assert.equal(byQuery.total, 1);
  });

  it('keeps samples bounded per group but always keeps what users saw', async () => {
    const batch = Array.from({ length: 70 }, () => ev());
    for (let i = 0; i < batch.length; i += 10) await ingestErrorEvents(db, batch.slice(i, i + 10), ctx({ random: () => 0 }));
    const gid = groupIdFor('production', (await listErrorGroups(db, { limit: 1, offset: 0 })).groups[0].fingerprint);
    const events = await listGroupEvents(db, gid, 100);
    assert.equal(events.length, ERROR_SAMPLE_LIMITS.maxPerGroup);
    const g = await getErrorGroup(db, gid);
    assert.equal(g?.samples, ERROR_SAMPLE_LIMITS.maxPerGroup);
    assert.equal(g?.occurrences, 70);
  });

  it('samples later background occurrences', async () => {
    const batch = Array.from({ length: 30 }, () => ev());
    await ingestErrorEvents(db, batch.slice(0, 15), ctx({ random: () => 0.99 }));
    await ingestErrorEvents(db, batch.slice(15), ctx({ random: () => 0.99 }));
    const g = (await listErrorGroups(db, { limit: 1, offset: 0 })).groups[0];
    assert.equal(g.samples, ERROR_SAMPLE_LIMITS.alwaysKeep);
  });

  it('rate limits a client per minute', async () => {
    assert.equal(await allowClientEvents(db, 'k1', ERROR_RATE_LIMITS.perIpMinute - 5, NOW), ERROR_RATE_LIMITS.perIpMinute - 5);
    assert.equal(await allowClientEvents(db, 'k1', 20, NOW), 5);
    assert.equal(await allowClientEvents(db, 'k1', 1, NOW), 0);
    assert.equal(await allowClientEvents(db, 'k1', 1, new Date(NOW.getTime() + 61_000)), 1, 'a new minute starts a new window');
    assert.equal(await allowClientEvents(db, 'k2', 1, NOW), 1, 'per client');
  });

  it('resolve: stays resolved on the same release, reopens on a newer one', async () => {
    await ingestErrorEvents(db, [ev({ release: 'rel1' })], ctx());
    const gid = (await listErrorGroups(db, { limit: 1, offset: 0 })).groups[0].id;
    const actor = { id: 'usr_admin001', email: 'admin@alummahnow.net' };
    await setErrorStatus(db, gid, 'resolved', actor, NOW);
    assert.equal((await getErrorGroup(db, gid))?.resolved_release, 'rel1');

    const later = new Date(NOW.getTime() + 60_000);
    await ingestErrorEvents(db, [ev({ release: 'rel1' })], { ...ctx(), now: later });
    assert.equal((await getErrorGroup(db, gid))?.status, 'resolved', 'an old tab on the resolved release does not reopen it');

    const out = await ingestErrorEvents(db, [ev({ release: 'rel2' })], { ...ctx(), now: new Date(later.getTime() + 60_000) });
    assert.deepEqual(out.reopened, [gid]);
    const g = await getErrorGroup(db, gid);
    assert.equal(g?.status, 'new');
    assert.ok(g?.regressed_at);
    const kinds = (await listGroupActivity(db, gid)).map((a) => a.kind);
    assert.deepEqual(kinds, ['created', 'status', 'reopened']);
  });

  it('records status, assignment and notes in the audit log', async () => {
    await ingestErrorEvents(db, [ev()], ctx());
    const gid = (await listErrorGroups(db, { limit: 1, offset: 0 })).groups[0].id;
    const actor = { id: 'usr_admin001', email: 'admin@alummahnow.net' };
    await setErrorStatus(db, gid, 'acknowledged', actor, NOW);
    await setErrorAssignee(db, gid, actor, actor, NOW);
    await addErrorNote(db, gid, 'Looking into it', actor, NOW);
    const activity = await listGroupActivity(db, gid);
    assert.deepEqual(activity.map((a) => [a.kind, a.from_status, a.to_status]), [['created', null, 'new'], ['status', 'new', 'acknowledged'], ['assign', null, null], ['note', null, null]]);
    assert.equal(activity[1].actor_email, 'admin@alummahnow.net');
    const mine = await listErrorGroups(db, { assignee: 'me', viewerId: actor.id, limit: 10, offset: 0 });
    assert.equal(mine.total, 1);
    assert.deepEqual(await errorCounts(db), { new: 0, acknowledged: 1, resolved: 0, ignored: 0 });
  });

  it('filters and sorts', async () => {
    await ingestErrorEvents(db, [ev(), ev(), ev({ app: 'api-videos', message: 'D1 timeout', stack: undefined, route: '/api/videos', release: 'relA' })], ctx());
    assert.equal((await listErrorGroups(db, { app: 'api-videos', limit: 10, offset: 0 })).total, 1);
    assert.equal((await listErrorGroups(db, { release: 'relA', limit: 10, offset: 0 })).total, 1);
    assert.equal((await listErrorGroups(db, { q: 'timeout', limit: 10, offset: 0 })).total, 1);
    assert.equal((await listErrorGroups(db, { from: '2026-11-10', limit: 10, offset: 0 })).total, 0);
    const byCount = await listErrorGroups(db, { sort: 'count', limit: 10, offset: 0 });
    assert.equal(byCount.groups[0].occurrences, 2);
  });

  it('hides test groups unless asked, and deletes them by reference (self-cleaning E2E)', async () => {
    const t = ev({ test: true, shown: true });
    await ingestErrorEvents(db, [t, ev()], ctx());
    assert.equal((await listErrorGroups(db, { limit: 10, offset: 0 })).total, 1);
    assert.equal((await listErrorGroups(db, { includeTest: true, limit: 10, offset: 0 })).total, 1 + 0, 'same fingerprint: the real event makes the group non-test');
    const only = ev({ test: true, message: 'E2E controlled client error', shown: true });
    await ingestErrorEvents(db, [only], ctx());
    assert.equal(await deleteTestGroupByRef(db, t.ref), 0, 'a group with real occurrences is never deleted');
    assert.equal(await deleteTestGroupByRef(db, only.ref), 1);
    assert.equal(await findByRef(db, only.ref), null);
  });

  it('prunes data older than 30 days and stale groups', async () => {
    await ingestErrorEvents(db, [ev()], ctx());
    const out = await pruneErrorData(db, new Date(NOW.getTime() + 31 * 86400_000));
    assert.equal(out.events, 1);
    const gone = await pruneErrorData(db, new Date(NOW.getTime() + 91 * 86400_000));
    assert.equal(gone.groups, 1);
  });
});

describe('needs-action items', () => {
  let db: D1Database;
  beforeEach(() => {
    db = sqliteD1();
  });
  const action = (key: string, over: Record<string, unknown> = {}) =>
    scrubEvent({
      app: 'processor',
      kind: 'action',
      ref: newErrorRef(),
      message: `failure for ${key}`,
      action: { key, source: 'dlq', title: 'Queue message dead-lettered', itemType: 'dead-letter', itemId: key.slice(4), retry: { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id: key.slice(4) } }, retryLabel: 'Replay', ...over },
    })!;

  it('one item per key under one group per source + title; repeats update it', async () => {
    await ingestErrorEvents(db, [action('dlq:m1'), action('dlq:m2'), action('dlq:m1')], ctx());
    const { groups } = await listErrorGroups(db, { needsAction: true, limit: 10, offset: 0 });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].open_actions, 2);
    assert.equal(groups[0].message, 'Queue message dead-lettered');
    const items = await listGroupActions(db, groups[0].id);
    assert.equal(items.find((i) => i.item_key === 'dlq:m1')?.occurrences, 2);
    assert.equal(await openActionCount(db), 2);
  });

  it('browser batches: no retry, own key namespace, admin-api environment', async () => {
    await ingestErrorEvents(db, [action('dlq:m9')], ctx());
    const spoof = { ...action('dlq:m9', { itemUrl: '/evil', title: 'Queue message dead-lettered' }), environment: 'stage' };
    await ingestErrorEvents(db, [spoof], ctx({ trustedRetry: false }));
    const gid = (await listErrorGroups(db, { limit: 1, offset: 0 })).groups[0].id;
    const items = await listGroupActions(db, gid);
    const worker = items.find((i) => i.item_key === 'dlq:m9')!;
    const browser = items.find((i) => i.item_key === 'browser:dlq:m9')!;
    assert.ok(worker.retry_json, 'the Worker item keeps its retry');
    assert.equal(worker.item_url, null, 'and is not overwritten by the browser report');
    assert.equal(browser.retry_json, null);
    assert.equal(browser.environment, 'production');
  });

  it('resolved by the feature, then reopened (with the group) when it fails again', async () => {
    await ingestErrorEvents(db, [action('dlq:m1')], ctx());
    const gid = (await listErrorGroups(db, { limit: 1, offset: 0 })).groups[0].id;
    await setErrorStatus(db, gid, 'resolved', { id: 'usr_admin001', email: null }, NOW);
    assert.equal(await resolveActionItems(db, 'production', ['dlq:m1', 'dlq:unknown'], NOW), 1);
    assert.equal(await openActionCount(db), 0);
    const out = await ingestErrorEvents(db, [action('dlq:m1')], ctx());
    assert.deepEqual(out.reopened, [gid]);
    assert.equal((await getErrorGroup(db, gid))?.status, 'new');
    assert.equal(await openActionCount(db), 1);
  });

  it('records retry attempts and dismissals in the item and the activity log', async () => {
    await ingestErrorEvents(db, [action('dlq:m1')], ctx());
    const gid = (await listErrorGroups(db, { limit: 1, offset: 0 })).groups[0].id;
    const item = (await listGroupActions(db, gid))[0];
    await recordActionAttempt(db, item, { status: 'open', result: 'processor /dlq/replay: 500' }, { id: 'usr_admin001', email: 'a@alummahnow.net' }, NOW);
    await recordActionAttempt(db, item, { status: 'resolved', result: 'processor /dlq/replay: 200' }, { id: 'usr_admin001', email: 'a@alummahnow.net' }, NOW);
    const after = await getActionItem(db, item.id);
    assert.equal(after?.attempts, 2);
    assert.equal(after?.status, 'resolved');
    assert.ok(after?.resolved_at);
    assert.deepEqual((await listGroupActivity(db, gid)).map((a) => a.kind), ['created', 'retry', 'retry']);
  });
});

describe('retry runner', () => {
  const env = (over: Record<string, unknown> = {}) => ({ REPORTS_DB: sqliteD1(), INTERNAL_API_KEY: 'k', ENVIRONMENT: 'production', ...over }) as never;

  it('runs only allowlisted service paths through the binding, with the internal key', async () => {
    const calls: { url: string; key: string | null; body: string }[] = [];
    const PROCESSOR = { fetch: async (url: string, init?: RequestInit) => (calls.push({ url, key: new Headers(init?.headers).get('X-API-Key'), body: String(init?.body) }), new Response('{}', { status: 200 })) };
    const ok = await runRetry(env({ PROCESSOR }), { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id: 'm1' } }, '1');
    assert.equal(ok.status, 'resolved');
    assert.deepEqual(calls, [{ url: 'https://processor.internal/dlq/replay', key: 'k', body: '{"id":"m1"}' }]);
    const refused = await runRetry(env({ PROCESSOR }), { kind: 'service', service: 'processor', path: '/admin/delete-everything' }, '1');
    assert.equal(refused.ok, false);
    assert.equal(calls.length, 1);
    assert.deepEqual(SERVICE_RETRIES.processor.paths, ['/dlq/replay', '/internal/quran/sync', '/internal/captions/claim']);
  });

  it('retries a failed upload playlist add through the api-videos binding', async () => {
    const calls: { url: string; body: string }[] = [];
    const VIDEOS = { fetch: async (url: string, init?: RequestInit) => (calls.push({ url, body: String(init?.body) }), new Response('{}', { status: 200 })) };
    const ok = await runRetry(env({ VIDEOS }), { kind: 'service', service: 'api-videos', path: '/internal/playlist-adds/retry', body: { videoId: 'v1', playlistId: 'p1' } }, '1');
    assert.equal(ok.status, 'resolved');
    assert.deepEqual(calls, [{ url: 'https://api-videos.internal/internal/playlist-adds/retry', body: '{"videoId":"v1","playlistId":"p1"}' }]);
    const refused = await runRetry(env({ VIDEOS }), { kind: 'service', service: 'api-videos', path: '/internal/admin/videos/delete' }, '1');
    assert.equal(refused.ok, false);
    assert.equal(calls.length, 1);
    const job = await runRetry(env({ VIDEOS }), { kind: 'service', service: 'api-videos', path: '/internal/captions/jobs/retry', body: { jobId: 'j1' } }, '1');
    assert.equal(job.status, 'resolved');
    assert.equal(calls[1].url, 'https://api-videos.internal/internal/captions/jobs/retry');
  });

  it('keeps the item open with the reason when the retry fails, dismisses a vanished item', async () => {
    const failing = { fetch: async () => new Response('boom', { status: 500 }) };
    assert.equal((await runRetry(env({ PROCESSOR: failing }), { kind: 'service', service: 'processor', path: '/dlq/replay' }, '1')).status, 'open');
    const gone = { fetch: async () => new Response('{}', { status: 404 }) };
    assert.equal((await runRetry(env({ PROCESSOR: gone }), { kind: 'service', service: 'processor', path: '/dlq/replay' }, '1')).status, 'dismissed');
    assert.equal((await runRetry(env(), { kind: 'builtin', handler: 'format-disk' }, '1')).ok, false);
    assert.equal((await runRetry(env(), null, '1')).ok, false);
  });
});

describe('Contact us emails that failed for good', () => {
  const contact = { id: 'cm1', name: 'Amina', email: 'amina@example.org', topic: 'general' as const, message: 'A message long enough.', locale: 'en' as const, pageUrl: null, userId: null, userAgent: 'test', ipHash: 'ip-a', now: NOW };
  const roomy = { perIpHour: 100, perIpDay: 100, perUserHour: 100, perUserDay: 100 } as never;

  it('flag a needs-action item linking to the message; Retry queues the email again', async () => {
    const db = sqliteD1();
    await insertContactMessage(db, contact, roomy);
    await recordDelivery(db, { messageId: 'cm1', kind: 'ack', status: 'failed', error: 'refused', now: NOW });
    const dlq: unknown[] = [];
    const queued: unknown[] = [];
    const env = { REPORTS_DB: db, ENVIRONMENT: 'production', ERRORS_DLQ: { send: async (m: unknown) => void dlq.push(m) }, CONTACT_MAIL_QUEUE: { send: async (m: unknown) => void queued.push(m), sendBatch: async (ms: { body: unknown }[]) => void queued.push(...ms.map((m) => m.body)) } } as never;
    await reportContactMailFailure(env, { v: 1, kind: 'ack', messageId: 'cm1' }, 'refused', 6);
    assert.equal(dlq.length, 1, 'still recorded in the platform DLQ');
    const item = await db.prepare('SELECT * FROM error_actions WHERE item_key = ?').bind(contactMailItemKey({ kind: 'ack', messageId: 'cm1' })).first<{ status: string; item_url: string; retry_json: string }>();
    assert.ok(item);
    assert.equal(item.status, 'open');
    assert.equal(item.item_url, '/contact/cm1');
    const spec = JSON.parse(item.retry_json);
    assert.deepEqual(spec, { kind: 'builtin', handler: 'contact-email', args: { id: 'cm1', kind: 'ack' } });

    const outcome = await runRetry(env, spec, '1');
    assert.equal(outcome.status, 'resolved');
    assert.equal(await deliveryStatus(db, 'cm1', 'ack'), 'queued');
    assert.equal(queued.length, 1);
    // Nothing failed any more: a second Retry sends nothing
    assert.equal((await runRetry(env, spec, '2')).result, 'Nothing to resend (queued)');
    assert.equal((await runRetry(env, { kind: 'builtin', handler: 'contact-email', args: { id: 'gone', kind: 'ack' } }, '1')).status, 'dismissed');
  });
});

describe('async ingest queue', () => {
  const msg = (events: ErrorEventInput[]): ErrorIngestMessage => ({ v: 1, events, resolved: [], trustedRetry: true, receivedAt: NOW.toISOString() });

  it('the endpoint path enqueues; without a queue it writes inline', async () => {
    const sent: unknown[] = [];
    const db = sqliteD1();
    assert.equal(await enqueueIngest({ REPORTS_DB: db, ERRORS_QUEUE: { send: async (m: unknown) => void sent.push(m) }, ENVIRONMENT: 'production' } as never, msg([ev()])), 'queued');
    assert.equal(sent.length, 1);
    assert.equal((await listErrorGroups(db, { limit: 10, offset: 0 })).total, 0, 'nothing written before the consumer runs');
    assert.equal(await enqueueIngest({ REPORTS_DB: db, ENVIRONMENT: 'production' } as never, msg([ev()])), 'written');
    assert.equal((await listErrorGroups(db, { limit: 10, offset: 0 })).total, 1);
  });

  it('the consumer acks written batches and retries failed ones with backoff', async () => {
    const db = sqliteD1();
    const acks: string[] = [];
    const retries: number[] = [];
    const message = (body: unknown, attempts = 1, tag = 'm') => ({ body, attempts, ack: () => acks.push(tag), retry: (o?: { delaySeconds?: number }) => retries.push(o?.delaySeconds ?? -1) });
    await consumeErrorQueue({ queue: 'al-ummah-now-errors', messages: [message(msg([ev()]), 1, 'ok'), message({ junk: true }, 1, 'junk')] }, { REPORTS_DB: db, ENVIRONMENT: 'production' } as never);
    assert.deepEqual(acks, ['ok', 'junk']);
    const broken = { prepare: () => { throw new Error('D1 unavailable'); }, batch: async () => { throw new Error('D1 unavailable'); } };
    await consumeErrorQueue({ queue: 'al-ummah-now-errors', messages: [message(msg([ev()]), 3)] }, { REPORTS_DB: broken, ENVIRONMENT: 'production' } as never);
    await consumeErrorQueue({ queue: 'al-ummah-now-errors-dlq', messages: [message(msg([ev()]), 1)] }, { REPORTS_DB: broken, ENVIRONMENT: 'production' } as never);
    assert.deepEqual(retries, [40, 900]);
    assert.deepEqual([retryDelaySeconds(1, false), retryDelaySeconds(10, false)], [10, 300]);
  });
});

describe('alerts', () => {
  it('mails new groups in production only, never test groups, within the hourly limit', async () => {
    const db = sqliteD1();
    const out = await ingestErrorEvents(db, [ev({ kind: 'boundary' }), ev({ kind: 'boundary', message: 'Other error', test: true })], ctx());
    const mails: string[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => (mails.push(JSON.parse(String(init?.body)).subject), new Response('{"id":"e1"}'))) as typeof fetch;
    const env = { ENVIRONMENT: 'production', RESEND_API_KEY: 'k', CONTACT_INBOX: 'support@alummahnow.net', ADMIN_WEB_URL: 'https://admin.alummahnow.net' };
    assert.equal(await sendErrorAlerts(db, { ...env, ENVIRONMENT: 'stage' }, out, NOW, fetchImpl), 0);
    assert.equal(await sendErrorAlerts(db, env, out, NOW, fetchImpl), 1);
    assert.match(mails[0], /^New error in web: Cannot read properties/);
    assert.equal(alertRecipient({ ERRORS_ALERT_TO: 'ops@alummahnow.net', CONTACT_INBOX: 'support@alummahnow.net' }), 'ops@alummahnow.net');

    // Over the hourly limit: recorded, not mailed
    const many = await ingestErrorEvents(db, Array.from({ length: ERROR_ALERT_LIMITS.perHour + 2 }, (_, i) => ev({ kind: 'boundary', message: `Distinct failure kind ${'abcdefghijklmnopqrstuvwxyz'[i]}` })), ctx());
    mails.length = 0;
    await sendErrorAlerts(db, env, many, NOW, fetchImpl);
    assert.equal(mails.length, ERROR_ALERT_LIMITS.perHour - 1);
  });

  it('mails only critical kinds: no mail for handled client problems', async () => {
    const db = sqliteD1();
    const out = await ingestErrorEvents(db, [
      ev({ kind: 'caught', message: 'WebSocket error (will reconnect)' }),
      ev({ kind: 'fetch', message: 'Failed to fetch' }),
      ev({ kind: 'unhandled', message: 'Browser-only crash' }),
      ev({ kind: 'player', message: 'Player stalled' }),
      ev({ app: 'api-videos', kind: 'http', message: 'GET /api/videos answered 500' }),
    ], ctx());
    const mails: string[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => (mails.push(JSON.parse(String(init?.body)).subject), new Response('{"id":"e1"}'))) as typeof fetch;
    const env = { ENVIRONMENT: 'production', RESEND_API_KEY: 'k', CONTACT_INBOX: 'support@alummahnow.net' };
    assert.equal(await sendErrorAlerts(db, env, out, NOW, fetchImpl), 1);
    assert.match(mails[0], /api-videos/);
    assert.equal(isAlertWorthy({ app: 'processor', kind: 'unhandled' }), true);
    assert.equal(isAlertWorthy({ app: 'web', kind: 'rejection' }), false);
    assert.equal(isAlertWorthy({ app: 'web', kind: 'action' }), true);
  });

  it('links to the group in the admin', () => {
    const mail = renderErrorAlert({ id: 'eg_0123456789abcdef', app: 'web', environment: 'production', kind: 'unhandled', name: 'TypeError', message: 'x', culprit: null, route: '/:locale', occurrences: 1, users: 1, last_release: 'r', first_seen: NOW.toISOString() } as never, 'new', { to: 'a@alummahnow.net', adminUrl: 'https://admin.alummahnow.net' });
    assert.match(mail.text, /https:\/\/admin\.alummahnow\.net\/errors\/eg_0123456789abcdef/);
  });
});

describe('RBAC', () => {
  it('grants errors:read and errors:manage to admins and super admins only', () => {
    assert.equal(hasPermission(['Admin'], 'errors:read'), true);
    assert.equal(hasPermission(['Super Admin'], 'errors:manage'), true);
    assert.equal(hasPermission(['Moderator'], 'errors:read'), false);
    assert.equal(hasPermission(['user'], 'errors:manage'), false);
    assert.ok(permissionsFor(['admin']).includes('errors:manage'));
  });
});

describe('source maps', () => {
  // Generated line 1: col 0 → a.ts 1:0, col 10 → b.ts 5:2 named "render"
  const map = JSON.stringify({ version: 3, sources: ['webpack://_N_E/./src/a.ts', 'webpack://_N_E/./src/b.tsx?x'], names: ['render'], mappings: 'AAAA,UCIEA' });

  it('decodes VLQ and maps positions to original sources', () => {
    assert.deepEqual(decodeVlq('UCIEA'), [10, 1, 4, 2, 0]);
    const m = ParsedSourceMap.parse(map)!;
    assert.deepEqual(m.lookup(1, 1), { source: 'src/a.ts', line: 1, column: 1, name: undefined });
    assert.deepEqual(m.lookup(1, 15), { source: 'src/b.tsx', line: 5, column: 3, name: 'render' });
    assert.equal(m.lookup(2, 1), null);
  });

  it('keys maps by app, release and chunk path; refuses traversal', () => {
    assert.equal(sourceMapKey('web', 'abc123', 'https://videos.alummahnow.net/_next/static/chunks/app/page-1.js?v=2'), 'web/abc123/_next/static/chunks/app/page-1.js.map');
    assert.equal(sourceMapKey('web', 'abc', 'https://x/_next/static/../../secret.js'), null);
    assert.equal(sourceMapKey('web', 'abc', 'https://x/other.js'), null);
  });

  it('symbolicates frames when the map exists and keeps the raw stack otherwise', async () => {
    clearSourceMapCache();
    const bucket = { get: async (key: string) => (key === 'web/rel1/_next/static/chunks/p.js.map' ? { text: async () => map } : null) };
    const frames = [{ fn: 'a', file: 'https://v/_next/static/chunks/p.js', line: 1, column: 12 }];
    assert.deepEqual(await symbolicateFrames(bucket, 'web', 'rel1', frames), [{ fn: 'render', file: 'src/b.tsx', line: 5, column: 3 }]);
    assert.equal(await symbolicateFrames(bucket, 'web', 'rel2', frames), null);
  });

  it('prunes maps older than 90 days', async () => {
    const deleted: string[][] = [];
    const bucket = {
      list: async () => ({ objects: [{ key: 'old', uploaded: new Date(NOW.getTime() - 91 * 86400_000) }, { key: 'new', uploaded: NOW }], truncated: false }),
      delete: async (keys: string | string[]) => void deleted.push([keys].flat()),
    };
    assert.equal(await pruneSourceMaps(bucket, NOW), 1);
    assert.deepEqual(deleted, [['old']]);
  });
});

describe('reporters', () => {
  beforeEach(() => resetServerReporterState());

  it('Worker reporter: sends once, folds repeats within 10 s into a count', async () => {
    const bodies: { events?: ErrorEventInput[] }[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), new Response('{}'))) as typeof fetch;
    const env = { ERRORS_INGEST_URL: 'https://admin.api/internal/errors', INTERNAL_API_KEY: 'k', ENVIRONMENT: 'production' };
    const waits: Promise<unknown>[] = [];
    const c = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    const ref = reportServerError('api-videos', env, c, new Error('D1 timeout'), { route: '/api/videos/abc123def', status: 500 }, fetchImpl);
    reportServerError('api-videos', env, c, new Error('D1 timeout'), { route: '/api/videos/zzz999xxx', status: 500 }, fetchImpl);
    await Promise.all(waits);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].events![0].ref, ref);
    assert.equal(bodies[0].events![0].app, 'api-videos');
  });

  it('withErrorReporting answers a crash with only a reference, and reports 5xx', async () => {
    const bodies: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => (bodies.push(String(init?.body)), new Response('{}'))) as typeof fetch;
    try {
      const waits: Promise<unknown>[] = [];
      const c = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
      const env = { ERRORS_INGEST_URL: 'https://admin.api/internal/errors', INTERNAL_API_KEY: 'k' };
      const crash = withErrorReporting('websocket', async () => {
        throw new Error('secret token=abc in stack');
      });
      const res = await crash(new Request('https://realtime/ws'), env, c);
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.doesNotMatch(text, /secret|stack/);
      assert.match(res.headers.get('X-Error-Ref') ?? '', /^ERR-/);
      const five = withErrorReporting('websocket', async () => new Response('x', { status: 502 }));
      const r2 = await five(new Request('https://realtime/health'), env, c);
      assert.match(r2.headers.get('X-Error-Ref') ?? '', /^ERR-/);
      await Promise.all(waits);
      assert.equal(bodies.length, 2);
      assert.doesNotMatch(bodies[0], /abc in/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('needs-action and resolve reporters post items and keys', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), new Response('{}'))) as typeof fetch;
    const env = { ERRORS_INGEST_URL: 'https://admin.api/internal/errors', INTERNAL_API_KEY: 'k' };
    const waits: Promise<unknown>[] = [];
    const c = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    reportNeedsAction('processor', env, c, { key: 'dlq:m1', source: 'dlq', title: 'Dead letter', message: 'boom', retry: { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id: 'm1' } } }, fetchImpl);
    resolveNeedsAction(env, c, 'dlq:m1', fetchImpl);
    await Promise.all(waits);
    assert.equal((bodies[0].events as ErrorEventInput[])[0].action?.key, 'dlq:m1');
    assert.deepEqual(bodies[1], { resolved: [{ key: 'dlq:m1' }] });
    await postReport({}, undefined, { resolved: [{ key: 'x' }] }, fetchImpl);
    assert.equal(bodies.length, 2, 'not configured: nothing sent');
  });

  it('browser reporter: shown errors always sent, repeats folded, noise ignored, sampling for network failures', () => {
    const sent: { events: ErrorEventInput[] }[] = [];
    const r = createErrorReporter({ app: 'web', getContext: () => ({ locale: 'ar', theme: 'fawanees', release: 'rel1', route: '/ar/video/abc123XYZ' }), transport: (b) => void sent.push(JSON.parse(b)), random: () => 0.9, flushDelayMs: 1_000_000 });
    const ref = r.report(new Error('Render failed'), { kind: 'boundary', shown: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].events[0].ref, ref);
    assert.equal(sent[0].events[0].locale, 'ar');
    for (let i = 0; i < 6; i++) r.report(new Error('Background thing'));
    r.report(new Error('ResizeObserver loop limit exceeded'));
    r.report(new TypeError('Failed to fetch'), { kind: 'fetch' });
    r.flush();
    const all = sent.flatMap((b) => b.events);
    const bg = all.filter((e) => e.message === 'Background thing');
    assert.equal(bg.length, 4, '3 in full + 1 folded');
    assert.equal(bg.at(-1)?.count, 3);
    assert.equal(all.some((e) => /ResizeObserver/.test(e.message)), false);
    assert.equal(all.some((e) => e.message === 'Failed to fetch'), false, 'sampled out at 0.25');
    r.needsAction({ key: 'upload:v1', source: 'upload', title: 'Upload finalisation failed', itemUrl: '/videos/v1' });
    r.flush();
    assert.equal(sent.at(-1)!.events[0].kind, 'action');
  });
});

describe('stack parsing stays linear on hostile input', () => {
  it('parses huge repetitive lines quickly', () => {
    const t0 = Date.now();
    parseStack(`at ${' '.repeat(50000)}x`);
    parseStack('@'.repeat(20000) + '@a'.repeat(20000));
    parseStack('at f (/a' + ':1'.repeat(20000) + ')');
    stableFile('#'.repeat(50000));
    parseUserAgent('Version/1' + ' '.repeat(50000));
    isVersionSkewError('deployment'.repeat(5000));
    assert.ok(Date.now() - t0 < 500);
  });
  it('still reads V8 frames with line and column', () => {
    assert.deepEqual(parseStack('Error: x\n    at async Foo.bar (https://v.net/_next/static/chunks/a.js:10:20)\n    at https://v.net/b.js:1:2\n    at new X (<anonymous>)'), [
      { fn: 'async Foo.bar', file: 'https://v.net/_next/static/chunks/a.js', line: 10, column: 20 },
      { fn: '<anonymous>', file: 'https://v.net/b.js', line: 1, column: 2 },
      { fn: 'new X', file: '<anonymous>' },
    ]);
  });
});

describe('browser batches are constrained to what the proxy vouches for', () => {
  it('app from the proxy, user from its session, capped counts, test only outside production', async () => {
    const { constrainBrowserEvents } = await import('../src/endpoints/errors/ErrorsIngest');
    const forged: ErrorEventInput[] = [
      { app: 'admin-api', kind: 'unhandled', ref: newErrorRef(), message: 'pretend Worker crash', userId: 'usr_victim', count: 1_000_000, test: true, environment: 'qa' },
      { app: 'web', kind: 'boundary', ref: newErrorRef(), message: 'real looking', userId: 'usr_victim', test: true },
    ];
    const prod = constrainBrowserEvents(forged, { app: 'web', userId: 'usr_me1234', environment: 'production' });
    assert.equal(prod.length, 2);
    for (const e of prod) {
      assert.equal(e.app, 'web');
      assert.equal(e.userId, 'usr_me1234');
      assert.equal(e.test, undefined);
      assert.equal(e.environment, undefined);
    }
    assert.equal(prod[0].count, 50);

    const anon = constrainBrowserEvents(forged, { environment: 'qa' });
    assert.deepEqual(anon.map((e) => e.app), ['web'], 'without X-Report-App a Worker app name is dropped');
    assert.equal(anon[0].userId, undefined, 'no session, no user, whatever the page claims');
    assert.equal(anon[0].test, true, 'test is honoured on QA/stage');
    assert.equal(constrainBrowserEvents(forged, { app: 'processor', environment: 'qa' }).length, 1, 'a bogus X-Report-App is ignored');
  });
});
