/**
 * Quran Foundation Content Sync (AUN-CAPTIONS mode A): bootstrap, incremental, rebuild, the 7-day
 * rule, retries and the admin flag. QF is a fake (`fetchImpl`): no test ever calls Quran Foundation.
 */
import {
  MessageType,
  QURAN_CURRENT_KEY,
  QURAN_STATE_KEY,
  QuranIndex,
  formatQuranRange,
  matchQuran,
  parseQuranRange,
  quranIndexKey,
  quranPassage,
  quranTextKey,
  type QuranCurrent,
  type QuranSurahFile,
} from '@al-ummah/shared-types';
import { QfClient } from '../quran/qf-client';
import { QuranCoreCollector, splitUthmaniWords } from '../quran/build';
import { streamSnapshotRecords } from '../quran/snapshot-stream';
import { enforceQuranFreshness, processQuranSyncMessages, quranRetryDelaySeconds, runQuranDaily, runQuranSync, type QuranBucket } from '../quran/sync';
import { handleQuranSyncRequest } from '../index';
import { MINI_QURAN, asr } from './fixtures/quran-mini';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn() } as never;

class MemoryBucket implements QuranBucket {
  store = new Map<string, string>();
  async get(key: string) {
    const v = this.store.get(key);
    return v === undefined ? null : { json: async <T>() => JSON.parse(v) as T };
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
  }
  async list({ prefix }: { prefix: string }) {
    return { objects: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
  }
  read<T>(key: string): T {
    return JSON.parse(this.store.get(key)!) as T;
  }
}

/** Fixture Uthmani text: the Imla'i words, with a pause mark in 55:7 and a section mark opening 55:8. */
const uthmani = (surah: number, ayah: number, text: string) => (surah === 55 && ayah === 7 ? text.replace('رفعها', 'رفعها ۚ') : surah === 55 && ayah === 8 ? `۞ ${text}` : text);

function snapshotRecords(opts: { breakVerse?: string } = {}) {
  const records: Array<Record<string, unknown>> = [];
  let wordId = 0;
  for (const surah of Object.keys(MINI_QURAN).map(Number).sort((a, b) => a - b)) {
    const ayat = MINI_QURAN[surah]!;
    records.push({ record_type: 'chapter', id: surah, chapter_number: surah, name_simple: `Surah ${surah}`, name_arabic: `سورة ${surah}`, verses_count: ayat.length, updated_at: 'x' });
    ayat.forEach((text, i) => {
      const key = `${surah}:${i + 1}`;
      const verseText = opts.breakVerse === key ? `${text} زائد` : uthmani(surah, i + 1, text);
      records.push({ record_type: 'verse', id: records.length, chapter_id: surah, verse_number: i + 1, verse_key: key, text_uthmani: verseText });
      const words = text.split(' ');
      words.forEach((w, k) => records.push({ record_type: 'word', id: ++wordId, verse_key: key, position: k + 1, location: `${key}:${k + 1}`, char_type_name: 'word', text_imlaei: w }));
      // The ayah-number marker: not a word
      records.push({ record_type: 'word', id: ++wordId, verse_key: key, position: words.length + 1, location: `${key}:${words.length + 1}`, char_type_name: 'end', text_imlaei: String(i + 1) });
    });
  }
  records.push({ record_type: 'juz', id: 1, juz_number: 1 });
  return records;
}

/** A body streamed in 37-byte chunks: records, strings and multi-byte letters split across reads. */
function chunked(text: string, size = 37): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

interface FakeQf {
  calls: string[];
  fetch: typeof fetch;
  /** Mutations returned to an incremental (token) sync */
  changes: Array<Record<string, unknown>>;
  resyncRequired: boolean;
  expireTokenOnce: boolean;
  status?: number;
  breakVerse?: string;
}

function fakeQf(init: Partial<FakeQf> = {}): FakeQf {
  const qf: FakeQf = { calls: [], changes: [], resyncRequired: false, expireTokenOnce: false, ...init } as FakeQf;
  let tokens = 0;
  let expired = false;
  qf.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.pathname === '/oauth2/token') {
      qf.calls.push('token');
      expect(headers.get('authorization')).toBe(`Basic ${btoa('client:secret')}`);
      expect(String(init?.body)).toContain('scope=content.sync.read');
      return Response.json({ access_token: `t${++tokens}`, expires_in: 3600 });
    }
    expect(headers.get('x-client-id')).toBe('client');
    if (qf.expireTokenOnce && !expired) {
      expired = true;
      qf.calls.push(`401 ${url.pathname}`);
      return Response.json({ error: 'invalid_token' }, { status: 401 });
    }
    if (qf.status) {
      qf.calls.push(`${qf.status} ${url.pathname}`);
      return Response.json({ error: { code: 'rate_limited' } }, { status: qf.status, headers: { 'retry-after': '120' } });
    }
    if (url.pathname === '/content/api/v4/resources/sync') {
      expect(url.searchParams.get('resources') ?? 'quran_core:1').toBe('quran_core:1');
      if (url.searchParams.get('bootstrap') === 'true') {
        qf.calls.push('bootstrap');
        return Response.json({ sync: { has_more: true, next_page_url: '/api/v4/resources/sync?cursor=PAGE2', mutations: [{ sequence: 1, type: 'RESOURCE_CREATE', resource_group: 'quran_core', resource_id: 1, snapshot_url: '/api/v4/resources/snapshots/quran_core/1' }] } });
      }
      if (url.searchParams.get('cursor') === 'PAGE2') {
        qf.calls.push('page2');
        return Response.json({ sync: { has_more: false, next_page_url: null, next_sync_token: 'TOKEN-1', mutations: [] } });
      }
      qf.calls.push(`sync ${url.searchParams.get('sync_token')}`);
      if (qf.resyncRequired) {
        qf.resyncRequired = false;
        return Response.json({ error: { code: 'resync_required' } }, { status: 409 });
      }
      return Response.json({ sync: { has_more: false, next_sync_token: 'TOKEN-2', mutations: qf.changes } });
    }
    if (url.pathname === '/content/api/v4/resources/snapshots/quran_core/1') {
      qf.calls.push('snapshot');
      const body = JSON.stringify({ resource_group: 'quran_core', resource_id: 1, resource_content_id: null, schema_version: 1, sync_sequence: 9, records: snapshotRecords({ breakVerse: qf.breakVerse }) });
      return new Response(chunked(body));
    }
    throw new Error(`Unexpected QF call ${url.pathname}`);
  }) as typeof fetch;
  return qf;
}

const env = (bucket = new MemoryBucket()) => ({
  REVIEW_MEDIA: bucket,
  QF_CLIENT_ID: 'client',
  QF_CLIENT_SECRET: { get: async () => 'secret' },
  QF_OAUTH_HOST: 'https://oauth2.example',
  QF_API_HOST: 'https://apis.example',
  MESSAGE_QUEUE: { send: jest.fn().mockResolvedValue(undefined) },
  INTERNAL_API_KEY: 'internal',
  ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors',
  ENVIRONMENT: 'qa',
});
const deps = (qf: FakeQf, now = new Date('2026-11-13T03:41:00.000Z')) => ({ logger, fetchImpl: qf.fetch, now, complete: false as const });

describe('the snapshot stream', () => {
  it('parses records split across reads, with braces and quotes inside strings', async () => {
    const records = [
      { record_type: 'verse', text_uthmani: 'a "quoted" {brace} [bracket] \\ end', n: 1 },
      { record_type: 'word', text_imlaei: 'بِسْمِ', nested: { list: [1, { deep: true }] } },
    ];
    const seen: unknown[] = [];
    const out = await streamSnapshotRecords(chunked(JSON.stringify({ resource_group: 'quran_core', resource_id: 1, schema_version: 1, records }), 5), (r) => seen.push(r));
    expect(seen).toEqual(records);
    expect(out.records).toBe(2);
    expect(out.envelope).toEqual({ resource_group: 'quran_core', resource_id: 1, schema_version: 1 });
  });

  it('a truncated snapshot fails', async () => {
    await expect(streamSnapshotRecords(chunked('{"records":[{"a":1},{"b"'), () => undefined)).rejects.toThrow(/truncated/);
  });
});

describe('the Uthmani words', () => {
  it('pause and section marks stay with a word; the words rejoin to the verse text', () => {
    expect(splitUthmaniWords('ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى')).toEqual(['ذَٰلِكَ', 'ٱلْكِتَٰبُ', 'لَا', 'رَيْبَ ۛ', 'فِيهِ ۛ', 'هُدًى']);
    expect(splitUthmaniWords('۞ إِنَّ ٱللَّهَ')).toEqual(['۞ إِنَّ', 'ٱللَّهَ']);
  });
});

describe('two-part words (QF writes بَعْدَ مَا and إِلْ يَاسِينَ as one word)', () => {
  const collect = (verse: string, imlaei: string[]) => {
    const c = new QuranCoreCollector();
    c.add({ record_type: 'chapter', chapter_number: 37, name_simple: 'As-Saffat', name_arabic: 'الصافات', verses_count: 1 });
    c.add({ record_type: 'verse', verse_key: '37:1', text_uthmani: verse });
    imlaei.forEach((w, i) => c.add({ record_type: 'word', char_type_name: 'word', location: `37:1:${i + 1}`, position: i + 1, text_imlaei: w }));
    return c.build('v1', '2026-11-16T00:00:00Z', { complete: false });
  };

  it('a word row spans as many Uthmani tokens as its Imla\'i text has words (37:130)', () => {
    const built = collect('سَلَٰمٌ عَلَىٰٓ إِلْ يَاسِينَ', ['سَلَامٌ', 'عَلَى', 'إِلْ يَاسِينَ']);
    expect(built.surahs[0]!.ayat[0]!.words).toEqual(['سَلَٰمٌ', 'عَلَىٰٓ', 'إِلْ يَاسِينَ']);
    // Both parts are in the index at word 3, as a reciter says them
    const index = new QuranIndex(built.index);
    expect(index.words).toEqual(['سلام', 'علي', 'ال', 'ياسين']);
    expect(index.locs.map((l) => l.word)).toEqual([1, 2, 3, 3]);
  });

  it('a pause mark inside a word row is not a word (13:37: عَرَبِيًّۭا ۚ … بَعْدَ مَا)', () => {
    const built = collect('حُكْمًا عَرَبِيًّۭا ۚ وَلَئِنِ ٱتَّبَعْتَ بَعْدَ مَا جَآءَكَ', ['حُكْمًا', 'عَرَبِيًّا ۚ', 'وَلَئِنِ', 'اتَّبَعْتَ', 'بَعْدَ مَا', 'جَاءَكَ']);
    expect(built.surahs[0]!.ayat[0]!.words).toEqual(['حُكْمًا', 'عَرَبِيًّۭا ۚ', 'وَلَئِنِ', 'ٱتَّبَعْتَ', 'بَعْدَ مَا', 'جَآءَكَ']);
  });

  it('a two-part Imla\'i row that the Uthmani text writes as one word is one token (2:21 يَٰٓأَيُّهَا)', () => {
    // prod 2026-11-14..18: 363 verses failed with "11 Uthmani words, 11 word rows"
    const built = collect('يَٰٓأَيُّهَا ٱلنَّاسُ ٱعْبُدُوا۟ رَبَّكُمُ', ['يا أيها', 'النَّاسُ', 'اعْبُدُوا', 'رَبَّكُمُ']);
    expect(built.surahs[0]!.ayat[0]!.words).toEqual(['يَٰٓأَيُّهَا', 'ٱلنَّاسُ', 'ٱعْبُدُوا۟', 'رَبَّكُمُ']);
    // Both parts are still in the index at word 1, as a reciter says them
    const index = new QuranIndex(built.index);
    expect(index.locs.filter((l) => l.word === 1)).toHaveLength(2);
  });

  it('tokens that still do not add up fail the build, never guessed', () => {
    expect(() => collect('سَلَٰمٌ عَلَىٰٓ إِلْ يَاسِينَ زائد', ['سَلَامٌ', 'عَلَى', 'إِلْ يَاسِينَ'])).toThrow('1 verse(s) failed the check');
  });
});

describe('Content Sync', () => {
  it('bootstraps: pages the change feed, streams the snapshot, writes the text and index, then the pointer and token', async () => {
    const e = env();
    const qf = fakeQf();
    const result = await runQuranSync(e, { reason: 'cron' }, deps(qf));
    expect(qf.calls).toEqual(['token', 'bootstrap', 'page2', 'snapshot']);
    expect(result.status).toBe('rebuilt');
    const current = e.REVIEW_MEDIA.read<QuranCurrent>(QURAN_CURRENT_KEY);
    expect(current).toEqual(expect.objectContaining({ version: '20261113T034100Z', syncedAt: '2026-11-13T03:41:00.000Z', surahs: 6 }));
    expect(e.REVIEW_MEDIA.read<{ syncToken: string }>(QURAN_STATE_KEY).syncToken).toBe('TOKEN-1');

    const r55 = e.REVIEW_MEDIA.read<QuranSurahFile>(quranTextKey(current.version, 55));
    expect(r55.name).toEqual({ ar: 'سورة 55', simple: 'Surah 55' });
    expect(r55.ayat).toHaveLength(18);
    expect(r55.ayat[6]!.words).toEqual(['والسماء', 'رفعها ۚ', 'ووضع', 'الميزان']);
    expect(r55.ayat[7]!.words[0]).toBe('۞ ألا');
    for (const a of r55.ayat) expect(a.words.join(' ')).toBe(a.text);

    // The index the matcher loads: markers left out, words numbered within the verse
    const index = new QuranIndex(e.REVIEW_MEDIA.read(quranIndexKey(current.version)));
    expect(index.version).toBe(current.version);
    const [m] = matchQuran(index, asr('قل هو الله احد الله الصمد لم يلد ولم يولد'));
    expect(formatQuranRange(m!.range)).toBe('112:1:1-112:3:4');
    expect(m!.class).toBe('confirmed');
  });

  it('the passage of a matched range is the official text (whole ayat verbatim, partial ayat by word)', async () => {
    const e = env();
    await runQuranSync(e, { reason: 'cron' }, deps(fakeQf()));
    const { version } = e.REVIEW_MEDIA.read<QuranCurrent>(QURAN_CURRENT_KEY);
    const r55 = e.REVIEW_MEDIA.read<QuranSurahFile>(quranTextKey(version, 55));
    expect(quranPassage(r55, parseQuranRange('55:7:1-55:8:2')!)).toEqual({
      ayat: [
        { ayah: 7, text: 'والسماء رفعها ۚ ووضع الميزان', partial: false },
        { ayah: 8, text: '۞ ألا تطغوا', partial: true },
      ],
    });
    expect(quranPassage(r55, parseQuranRange('55:18:1-55:18:9')!)).toBeNull();
    expect(quranPassage(r55, parseQuranRange('55:19:1-55:19:1')!)).toBeNull();
  });

  it('no change: only the sync time moves (no snapshot); a change rebuilds a new version and keeps one before it', async () => {
    const e = env();
    await runQuranSync(e, { reason: 'cron' }, deps(fakeQf()));
    const qf = fakeQf();
    const quiet = await runQuranSync(e, { reason: 'cron' }, deps(qf, new Date('2026-11-14T03:41:00.000Z')));
    expect(quiet.status).toBe('unchanged');
    expect(qf.calls).toEqual(['token', 'sync TOKEN-1']);
    expect(e.REVIEW_MEDIA.read<QuranCurrent>(QURAN_CURRENT_KEY)).toEqual(expect.objectContaining({ version: '20261113T034100Z', syncedAt: '2026-11-14T03:41:00.000Z' }));
    expect(e.REVIEW_MEDIA.read<{ syncToken: string }>(QURAN_STATE_KEY).syncToken).toBe('TOKEN-2');

    // A freshness marker is not a change; a row update is
    const marker = fakeQf({ changes: [{ type: 'RESOURCE_UPDATE', resource_group: 'quran_core', resource_id: 1 }, { type: 'ROW_UPDATE', resource_group: 'translations', resource_id: 19 }] });
    expect((await runQuranSync(e, { reason: 'cron' }, deps(marker, new Date('2026-11-15T03:41:00.000Z')))).status).toBe('unchanged');
    const rowUpdate = { type: 'ROW_UPDATE', resource_group: 'quran_core', resource_id: 1, record_type: 'word', record_key: '1' };
    await runQuranSync(e, { reason: 'cron' }, deps(fakeQf({ changes: [rowUpdate] }), new Date('2026-11-16T03:41:00.000Z')));
    await runQuranSync(e, { reason: 'cron' }, deps(fakeQf({ changes: [rowUpdate] }), new Date('2026-11-17T03:41:00.000Z')));
    expect(e.REVIEW_MEDIA.read<QuranCurrent>(QURAN_CURRENT_KEY).version).toBe('20261117T034100Z');
    const versions = new Set([...e.REVIEW_MEDIA.store.keys()].filter((k) => k.startsWith('quran/index/')));
    expect(versions).toEqual(new Set([quranIndexKey('20261117T034100Z'), quranIndexKey('20261116T034100Z')]));
    expect([...e.REVIEW_MEDIA.store.keys()].some((k) => k.startsWith('quran/text/20261113T034100Z/'))).toBe(false);
  });

  it('resync_required starts over with a bootstrap; an expired token is refreshed once', async () => {
    const e = env();
    await runQuranSync(e, { reason: 'cron' }, deps(fakeQf()));
    const qf = fakeQf({ resyncRequired: true, expireTokenOnce: true });
    expect((await runQuranSync(e, { reason: 'cron' }, deps(qf))).status).toBe('rebuilt');
    expect(qf.calls).toEqual(['token', '401 /content/api/v4/resources/sync', 'token', 'sync TOKEN-1', 'bootstrap', 'page2', 'snapshot']);
  });

  it('never calls the real QF from a test', () => {
    expect(() => new QfClient(env())).toThrow(/Refusing to call Quran Foundation/);
  });
});

describe('the queue job and the admin', () => {
  const realFetch = global.fetch;
  let posts: Array<{ events?: Array<{ kind: string; action?: Record<string, unknown> }>; resolved?: Array<{ key: string }> }>;
  let pending: Promise<unknown>[];
  const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p) });
  beforeEach(() => {
    posts = [];
    pending = [];
    global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });
  const message = (attempts = 1, payload: unknown = { reason: 'cron' }) => ({ body: { id: 'm1', type: MessageType.QuranContentSync, payload }, attempts, ack: jest.fn(), retry: jest.fn() });

  it('QF busy (429): retried with backoff, at least its Retry-After; the DLQ takes it after the last retry', async () => {
    const m = message(2);
    await processQuranSyncMessages([m], env(), ctx(), logger, { fetchImpl: fakeQf({ status: 429 }).fetch, complete: false });
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(m.ack).not.toHaveBeenCalled();
    expect(quranRetryDelaySeconds(4)).toBe(480);
    expect(quranRetryDelaySeconds(9)).toBe(1800);
    // A Retry-After past the 30-minute cap is still honoured (up to the queue's 12 h limit)
    expect(quranRetryDelaySeconds(1, 7200)).toBe(7200);
    expect(quranRetryDelaySeconds(1, 99_999)).toBe(43_200);
    await Promise.all(pending);
    expect(posts).toHaveLength(0);
  });

  it('QF busy with Retry-After as an HTTP date: the retry waits until then', async () => {
    const m = message(1);
    const at = new Date(Date.now() + 600_000).toUTCString();
    const fetchImpl = (async (input: RequestInfo | URL) =>
      String(input).endsWith('/oauth2/token')
        ? Response.json({ access_token: 't', expires_in: 3600 })
        : Response.json({ message: 'Too many requests, please try again later', type: 'rate_limit_exceeded' }, { status: 429, headers: { 'retry-after': at } })) as typeof fetch;
    await processQuranSyncMessages([m], env(), ctx(), logger, { fetchImpl, complete: false });
    const delay = (m.retry.mock.calls[0]![0] as { delaySeconds: number }).delaySeconds;
    expect(delay).toBeGreaterThanOrEqual(598);
    expect(delay).toBeLessThanOrEqual(601);
  });

  it('a verse that fails the check: nothing is written, the token stays, the admin is flagged with Sync now', async () => {
    const e = env();
    await runQuranSync(e, { reason: 'cron' }, deps(fakeQf()));
    const before = e.REVIEW_MEDIA.read<QuranCurrent>(QURAN_CURRENT_KEY);
    const m = message();
    await processQuranSyncMessages([m], e, ctx(), logger, { fetchImpl: fakeQf({ breakVerse: '112:2', changes: [{ type: 'RESOURCE_INVALIDATE', resource_group: 'quran_core', resource_id: 1 }] }).fetch, now: new Date('2026-11-14T03:41:00.000Z'), complete: false });
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(e.REVIEW_MEDIA.read<QuranCurrent>(QURAN_CURRENT_KEY)).toEqual(before);
    expect(e.REVIEW_MEDIA.read<{ syncToken: string }>(QURAN_STATE_KEY).syncToken).toBe('TOKEN-1');
    await Promise.all(pending);
    const action = posts[0]!.events![0]!.action!;
    expect(action).toEqual(expect.objectContaining({ key: 'quran-sync', source: 'queue', retry: { kind: 'service', service: 'processor', path: '/internal/quran/sync', body: {} }, retryLabel: 'Sync now' }));
    expect(JSON.stringify(posts[0]!.events![0])).toContain('112:2');

    // The next good run resolves it
    pending = [];
    await processQuranSyncMessages([message()], e, ctx(), logger, { fetchImpl: fakeQf().fetch, complete: false });
    await Promise.all(pending);
    expect(posts[1]!.resolved).toEqual([{ key: 'quran-sync' }, { key: 'quran-stale' }]);
  });

  it('a copy not synced for 7 days is deleted and flagged; the daily run then queues a sync', async () => {
    const e = env();
    await runQuranSync(e, { reason: 'cron' }, deps(fakeQf()));
    expect(await enforceQuranFreshness(e, ctx(), logger, Date.parse('2026-11-19T03:41:00.000Z'))).toBe(false);
    expect(await runQuranDaily(e, ctx(), logger, Date.parse('2026-11-20T04:00:00.000Z'))).toBe('queued');
    expect([...e.REVIEW_MEDIA.store.keys()]).toEqual([QURAN_STATE_KEY]);
    expect(e.REVIEW_MEDIA.read<{ syncToken?: string }>(QURAN_STATE_KEY).syncToken).toBeUndefined();
    expect(e.MESSAGE_QUEUE.send).toHaveBeenCalledWith(expect.objectContaining({ type: MessageType.QuranContentSync, payload: { reason: 'cron' } }));
    await Promise.all(pending);
    expect(posts[0]!.events![0]!.action).toEqual(expect.objectContaining({ key: 'quran-stale', retryLabel: 'Sync now' }));
  });

  it('a copy not synced for over 3 days flags the admin while it is still served (a good sync resolves it: see above)', async () => {
    const e = env();
    await runQuranSync(e, { reason: 'cron' }, deps(fakeQf()));
    expect(await enforceQuranFreshness(e, ctx(), logger, Date.parse('2026-11-15T03:41:00.000Z'))).toBe(false);
    await Promise.all(pending);
    expect(posts).toHaveLength(0);
    expect(await enforceQuranFreshness(e, ctx(), logger, Date.parse('2026-11-17T04:00:00.000Z'))).toBe(false);
    expect(e.REVIEW_MEDIA.store.has(QURAN_CURRENT_KEY)).toBe(true);
    await Promise.all(pending);
    expect(posts[0]!.events![0]!.action).toEqual(expect.objectContaining({ key: 'quran-stale', title: 'Quran text not synced with Quran Foundation for 4 days', retryLabel: 'Sync now' }));
  });

  it('the daily run is skipped where QF is not configured', async () => {
    const e = { ...env(), QF_CLIENT_ID: undefined };
    expect(await runQuranDaily(e, ctx(), logger)).toBe('skipped');
    expect(e.MESSAGE_QUEUE.send).not.toHaveBeenCalled();
  });

  it('POST /internal/quran/sync queues a rebuild for an internal caller only', async () => {
    const e = env();
    const req = (key?: string) => new Request('https://p/internal/quran/sync', { method: 'POST', headers: key ? { 'X-API-Key': key } : {}, body: '{}' });
    expect((await handleQuranSyncRequest(req(), e as never, logger)).status).toBe(401);
    expect((await handleQuranSyncRequest(req('wrong-key'), e as never, logger)).status).toBe(401);
    expect((await handleQuranSyncRequest(req('internal'), e as never, logger)).status).toBe(202);
    expect(e.MESSAGE_QUEUE.send).toHaveBeenCalledWith(expect.objectContaining({ type: MessageType.QuranContentSync, payload: { reason: 'admin', rebuild: true } }));
  });
});
