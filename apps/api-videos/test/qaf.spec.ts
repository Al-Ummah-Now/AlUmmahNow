import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp, MemoryBucket } from './helpers';
import { QafAvailability, QafSearch, QafReadPassage, QafCatalogLookup } from '../src/endpoints/community/qaf';
import { SqliteD1 } from './search-sqlite-d1';
import { parseQafQuote, writeQafQuote } from '@al-ummah/shared-types';
import { sanitizePostContent } from '../src/lib/post-content';
import { QafError, queryQaf, readQafSettings, saveQafSettings } from '../src/lib/qaf/service';

const id = 'd9335f69-e54b-59ae-a78c-50db734b8d50';
const passage = {
  id, title: 'Fayd al-Qadir', url: `https://qaf.ai/passages/${id}`,
  turathUrl: 'https://app.turath.io/book/21660?print_page=4%2C233',
  text: '  إِنَّمَا **الأعمال**\n\n<…> & &#60; ١٢  ',
  pages: [{ vol: '4', page: 233 }],
  book: { id, title: 'Fayd al-Qadir', titleArabic: 'فيض القدير' },
  author: { id: 423, name: 'Al-Munawi', nameArabic: 'المناوي' },
};

function fixture() {
  const db = new SqliteD1();
  const env = { SEARCH_DB: db as unknown as D1Database, INTERNAL_API_KEY: 'test-sealing-key-for-qaf' };
  return { env, sqlite: db.db };
}

test('Qaf is disabled by default and the key is sealed and omitted from settings', async () => {
  const { env, sqlite } = fixture();
  assert.equal((await readQafSettings(env)).connected, false);
  const view = await saveQafSettings(env, { key: 'qaf_sk_test_secret' });
  assert.equal(view.connected, true);
  assert.doesNotMatch(JSON.stringify(view), /qaf_sk/);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare('SELECT * FROM qaf_settings').get()), /qaf_sk/);
});

test('normalised searches hit the cache and user and global weekly caps apply across channels', async () => {
  const { env } = fixture();
  await saveQafSettings(env, { key: 'qaf_sk_test_secret', userWeek: 1, globalWeek: 2 });
  let calls = 0;
  const fake = async () => { calls++; return Response.json({ results: [passage] }); };
  const search = (user: string, query: string) => queryQaf(env, user, { kind: 'search', input: { query } }, { fetch: fake });
  assert.deepEqual(await search('a', 'الصبر عند المصيبة'), { results: [passage] });
  assert.deepEqual(await search('a', ' الصبر  عند المصيبة '), { results: [passage] });
  await assert.rejects(search('a', 'النية'), (e) => e instanceof QafError && e.code === 'user_week');
  await search('b', 'النية');
  await assert.rejects(search('c', 'الزكاة'), (e) => e instanceof QafError && e.code === 'week');
  assert.equal(calls, 2);
  assert.equal((await readQafSettings(env)).weeklyRemaining, 0);
});

for (const reason of ['week', 'invalid_keys'] as const) {
  test(`Qaf stops and flags ${reason} once`, async () => {
    const { env } = fixture();
    await saveQafSettings(env, { key: 'qaf_sk_test_secret' });
    const reported: string[] = [];
    let calls = 0;
    const fake = async () => {
      calls++;
      return Response.json({ data: { reason } }, { status: 429, headers: { 'Retry-After': '120' } });
    };
    for (let i = 0; i < 2; i++) {
      await assert.rejects(queryQaf(env, 'a', { kind: 'search', input: { query: 'الصبر' } }, {
        fetch: fake, report: (code) => { reported.push(code); },
      }), (e) => e instanceof QafError && e.code === reason && (e.retryAfter ?? 0) >= (reason === 'week' ? 119 : 0));
    }
    assert.equal(calls, 1);
    assert.deepEqual(reported, [reason]);
  });
}

test('a quoted passage and citation round trip without modifying the text', () => {
  for (const locale of ['en', 'ar'] as const) {
    const label = locale === 'ar' ? 'فيض القدير — المناوي، ٤:٢٣٣' : 'Fayd al-Qadir — Al-Munawi, 4:233';
    assert.deepEqual(parseQafQuote(writeQafQuote(passage.text, label, passage.url)), { text: passage.text, label, url: passage.url });
  }
});

test('validates credential and route input before forwarding any request', async () => {
  const { env } = fixture();
  await assert.rejects(saveQafSettings(env, { key: 'qaf_sk_test_secret\r\nX-Injected: yes' }), /invalid_request/);
  assert.equal((await readQafSettings(env)).connected, false);

  let calls = 0;
  const fake = async () => { calls++; return Response.json(passage); };
  await saveQafSettings(env, { key: 'qaf_sk_test_secret' });
  for (const id of ['../search', 'a%2Fsearch', 'a%2fsearch']) {
    await assert.rejects(queryQaf(env, 'a', { kind: 'context', id, input: { radius: 5 } }, { fetch: fake }));
  }
  await assert.rejects(queryQaf(env, 'a', { kind: 'context', id, input: { radius: 6 } }, { fetch: fake }));
  await assert.rejects(queryQaf(env, 'a', { kind: 'catalog', input: { type: '../search', query: 'Ibn Hajar' } } as never, { fetch: fake }));
  await assert.rejects(queryQaf(env, 'a', { kind: 'search', input: { query: 'الإخلاص', extra: true } } as never, { fetch: fake }));
  assert.equal(calls, 0);
});

test('forwards the topic as bound data and hashes the cache key', async () => {
  const { env, sqlite } = fixture();
  await saveQafSettings(env, { key: 'qaf_sk_test_secret' });
  const query = "'); DROP TABLE qaf_settings; --";
  await queryQaf(env, "'); DROP TABLE qaf_usage; --", { kind: 'search', input: { query } }, {
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.qaf.ai/v1/search');
      assert.equal(init?.redirect, 'error');
      assert.equal(JSON.parse(String(init?.body)).query, query);
      return Response.json({ results: [passage] });
    },
  });
  const cached = sqlite.prepare('SELECT hash FROM qaf_search_cache').get();
  assert.match(String(cached?.hash), /^[a-f0-9]{64}$/);
  assert.equal((await readQafSettings(env)).weeklyRemaining, 999);
});

test('retries temporary upstream errors and counts each outbound request in the minute cap', async () => {
  const { env } = fixture();
  await saveQafSettings(env, { key: 'qaf_sk_test_secret', globalMinute: 3, userMinute: 3 });
  const pauses: number[] = [];
  let calls = 0;
  const fake = async () => {
    calls++;
    return calls < 3 ? Response.json({}, { status: 503 }) : Response.json({ results: [passage] });
  };
  await queryQaf(env, 'a', { kind: 'search', input: { query: 'الصبر' } }, {
    fetch: fake, sleep: async (seconds) => { pauses.push(seconds); },
  });
  await assert.rejects(queryQaf(env, 'b', { kind: 'search', input: { query: 'الإخلاص' } }, { fetch: fake }), /minute/);
  assert.deepEqual(pauses, [0.25, 0.5]);
  assert.equal(calls, 3);
  assert.equal((await readQafSettings(env)).weeklyRemaining, 999);
});

test('rejects unsafe citation origins and preserves Qaf payloads as escaped text through post sanitization', async () => {
  const { env } = fixture();
  await saveQafSettings(env, { key: 'qaf_sk_test_secret' });
  const request = { kind: 'search', input: { query: 'الصبر' } } as const;
  for (const url of ['javascript:alert(1)', 'data:text/html,a', 'https://qaf.ai.example/book']) {
    await assert.rejects(queryQaf(env, 'a', request, {
      fetch: async () => Response.json({ results: [{ ...passage, url }] }),
    }), /invalid_response/);
    assert.throws(() => writeQafQuote(passage.text, 'book', url), /Invalid Qaf citation/);
  }
  const injected = { ...passage, text: '<script>alert(1)</script>\n<img src=x onerror=alert(2)>', book: { ...passage.book, title: '<b>Book</b>' } };
  const result = await queryQaf(env, 'a', request, {
    fetch: async () => Response.json({ results: [injected] }),
  });
  assert.deepEqual(result, { results: [injected] });
  const raw = writeQafQuote(injected.text, injected.book.title, injected.url);
  assert.equal(sanitizePostContent(raw), raw);
  assert.deepEqual(parseQafQuote(raw), { text: injected.text, label: injected.book.title, url: injected.url });
  assert.equal(sanitizePostContent(`<img src=x onerror="alert(1)">\n\n${raw}\n\n<a href="javascript:alert(3)">click</a>`), `\n\n${raw}\n\n<a>click</a>`);
});

test('authenticated creator routes block callers without posting access and report upstream refusals to Errors', async (t) => {
  const { env } = fixture();
  const events: Array<Record<string, unknown>> = [];
  const waiting: Promise<unknown>[] = [];
  const execution = { waitUntil: (p: Promise<unknown>) => waiting.push(p) } as unknown as ExecutionContext;
  const route = '/api/community/channels/channel/sources';
  const bindings = {
    ...env,
    channels: new MemoryBucket({ channel: { id: 'channel', userId: 'owner', name: 'A channel' } }),
    ERRORS_INGEST_URL: 'https://admin.example/internal/errors',
  };
  function register(router: ReturnType<typeof import('chanfana').fromHono>) {
    const route = '/api/community/channels/:channelId/sources';
    router.get(route, QafAvailability);
    router.post(`${route}/search`, QafSearch);
    router.get(`${route}/passages/:id`, QafReadPassage);
    router.get(`${route}/catalog`, QafCatalogLookup);
  }
  const anonymous = buildApp(register);
  const free = buildApp(register, { userId: 'owner' });
  const other = buildApp(register, { userId: 'other', roles: ['super_admin'] });
  const owner = buildApp(register, { userId: 'owner', roles: ['super_admin'] });
  assert.equal((await anonymous.request(route, {}, bindings)).status, 401);
  assert.equal((await free.request(route, {}, bindings)).status, 403);
  assert.equal((await other.request(route, {}, bindings)).status, 403);
  assert.deepEqual(await (await owner.request(route, {}, bindings)).json(), { enabled: false });
  await saveQafSettings(env, { key: 'qaf_sk_test_secret' });
  assert.deepEqual(await (await owner.request(route, {}, bindings)).json(), { enabled: true });

  let nextReason = 'week';
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url === bindings.ERRORS_INGEST_URL) {
      events.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true });
    }
    assert.equal(url, 'https://api.qaf.ai/v1/search');
    return Response.json({ data: { reason: nextReason } }, { status: 429, headers: { 'Retry-After': '60' } });
  });
  for (const path of ['../search', 'path%2Fsearch']) {
    assert.ok((await owner.request(`${route}/passages/${path}`, {}, bindings, execution)).status >= 400);
  }
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'private-draft-topic' }),
  };
  const week = await owner.request(`${route}/search`, init, bindings, execution);
  assert.equal(week.status, 429);
  assert.equal(week.headers.get('Retry-After'), '60');
  nextReason = 'invalid_keys';
  await saveQafSettings(env, { key: 'qaf_sk_test_replacement' });
  const invalid = await owner.request(`${route}/search`, init, bindings, execution);
  assert.equal(invalid.status, 503);
  assert.deepEqual(await invalid.json(), { error: 'invalid_keys' });
  await Promise.all(waiting);
  const reports = JSON.stringify(events);
  assert.match(reports, /qaf-sources:week/);
  assert.match(reports, /qaf-sources:invalid_keys/);
  assert.doesNotMatch(reports, /qaf_sk_|private-draft-topic/);
});

test('honors the minute Retry-After once and leaves the weekly allowance charged once', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { env } = fixture();
  await saveQafSettings(env, { key: 'qaf_sk_test_secret' });
  let attempts = 0;
  const delays: number[] = [];
  await queryQaf(env, 'creator', { kind: 'search', input: { query: 'الصبر' } }, {
    fetch: async () => {
      attempts++;
      if (attempts === 1) return Response.json({ data: { reason: 'minute' } }, { status: 429, headers: { 'Retry-After': '32' } });
      return Response.json({ results: [passage] });
    },
    sleep: async (seconds) => {
      delays.push(seconds);
      t.mock.timers.setTime(Date.now() + seconds * 1000);
    },
  });
  assert.deepEqual(delays, [32]);
  assert.equal(attempts, 2);
  assert.equal((await readQafSettings(env)).weeklyRemaining, 999);
});
