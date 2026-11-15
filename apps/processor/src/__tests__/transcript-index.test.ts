/**
 * Transcript search index updates (AUN-CAPTIONS §5.10): the processor reads the published track
 * from the subtitles bucket and replaces its passages; failures retry, then flag the admin with a
 * Retry. The SQL itself runs against real FTS5 in api-videos' transcript-search.spec.ts; here a
 * recording D1 fake checks what is written.
 */
import { MessageType } from '@al-ummah/shared-types';
import {
  TRANSCRIPT_INDEX_LAST_ATTEMPT,
  isTranscriptIndexPayload,
  processTranscriptIndexMessages,
  transcriptIndexRetryDelaySeconds,
} from '../search/transcripts';
import { handleTranscriptIndexRequest } from '../index';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn() } as never;

class FakeDb {
  batches: Array<Array<{ sql: string; values: unknown[] }>> = [];
  indexedVersion: number | null = null;
  fail = false;
  prepare = (sql: string) => {
    const stmt = (values: unknown[]) => ({
      sql,
      values,
      bind: (...v: unknown[]) => stmt(v),
      first: async () => ({ v: this.indexedVersion }),
      all: async () => ({ results: [] }),
      run: async () => ({}),
    });
    return stmt([]);
  };
  async batch(statements: Array<{ sql: string; values: unknown[] }>) {
    if (this.fail) throw new Error('D1 overloaded');
    this.batches.push(statements.map((s) => ({ sql: s.sql, values: s.values })));
    return [];
  }
  inserted() {
    return this.batches.flat().filter((s) => s.sql.startsWith('INSERT INTO search_transcripts ')).map((s) => s.values);
  }
}

class Bucket {
  store = new Map<string, string>();
  async get(key: string) {
    const v = this.store.get(key);
    return v === undefined ? null : { text: async () => v, uploaded: new Date('2026-11-14T10:00:00.000Z') };
  }
}

function env() {
  const subtitles = new Bucket();
  subtitles.store.set('v1/en.vtt', 'WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nPatience and prayer\n');
  return {
    SEARCH_DB: new FakeDb(),
    subtitles,
    MESSAGE_QUEUE: { send: jest.fn().mockResolvedValue(undefined) },
    INTERNAL_API_KEY: 'internal',
    ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors',
    ENVIRONMENT: 'qa',
  };
}
const message = (attempts = 1, payload: unknown = { videoId: 'v1', language: 'en', version: 1 }) => ({
  body: { id: 'm1', type: MessageType.TranscriptIndexSync, payload },
  attempts,
  ack: jest.fn(),
  retry: jest.fn(),
});

describe('transcript index messages', () => {
  const realFetch = global.fetch;
  let posts: Array<{ events?: Array<{ action?: Record<string, unknown> }>; resolved?: unknown }>;
  let pending: Promise<unknown>[];
  const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p) });
  beforeEach(() => {
    posts = [];
    pending = [];
    global.fetch = jest.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('indexes the stored track, at the stored file\'s time, and resolves the admin item', async () => {
    const e = env();
    const m = message();
    await processTranscriptIndexMessages([m], e, ctx(), logger);
    expect(m.ack).toHaveBeenCalled();
    expect(e.SEARCH_DB.inserted()).toEqual([['v1', 'en', 5000, 'Patience and prayer', Date.parse('2026-11-14T10:00:00.000Z')]]);
    await Promise.all(pending);
    expect(JSON.stringify(posts)).toContain('transcript-index:v1:en');
  });

  it('a deleted track removes its passages', async () => {
    const e = env();
    e.subtitles.store.delete('v1/en.vtt');
    const m = message(1, { videoId: 'v1', language: 'en', version: 99 });
    await processTranscriptIndexMessages([m], e, ctx(), logger);
    expect(m.ack).toHaveBeenCalled();
    const sql = e.SEARCH_DB.batches.flat().map((s) => s.sql);
    expect(sql.some((s) => s.startsWith('DELETE FROM search_transcripts '))).toBe(true);
    expect(e.SEARCH_DB.inserted()).toEqual([]);
  });

  it('retries with backoff, then flags the admin with Try again', async () => {
    const e = env();
    e.SEARCH_DB.fail = true;
    const first = message(1);
    await processTranscriptIndexMessages([first], e, ctx(), logger);
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: transcriptIndexRetryDelaySeconds(1) });
    expect(first.ack).not.toHaveBeenCalled();

    const last = message(TRANSCRIPT_INDEX_LAST_ATTEMPT);
    await processTranscriptIndexMessages([last], e, ctx(), logger);
    expect(last.ack).toHaveBeenCalled();
    expect(last.retry).not.toHaveBeenCalled();
    await Promise.all(pending);
    expect(posts[0]!.events![0]!.action).toEqual(
      expect.objectContaining({
        key: 'transcript-index:v1:en',
        retry: { kind: 'service', service: 'processor', path: '/internal/search/transcript', body: { videoId: 'v1', language: 'en' } },
        retryLabel: 'Try again',
      }),
    );
  });

  it('drops a malformed message', async () => {
    const e = env();
    const m = message(1, { videoId: '../x', language: 'en', version: 1 });
    await processTranscriptIndexMessages([m], e, ctx(), logger);
    expect(m.ack).toHaveBeenCalled();
    expect(e.SEARCH_DB.batches).toHaveLength(0);
    expect(isTranscriptIndexPayload({ videoId: 'v1', language: 'english', version: 1 })).toBe(false);
  });

  it('POST /internal/search/transcript (the admin\'s Try again) re-queues for an internal caller only', async () => {
    const e = env();
    const req = (key?: string, body: unknown = { videoId: 'v1', language: 'en' }) =>
      new Request('https://p/internal/search/transcript', { method: 'POST', headers: key ? { 'X-API-Key': key } : {}, body: JSON.stringify(body) });
    expect((await handleTranscriptIndexRequest(req(), e as never, logger)).status).toBe(401);
    expect((await handleTranscriptIndexRequest(req('internal', { videoId: 'v1', language: 'x/y' }), e as never, logger)).status).toBe(400);
    expect((await handleTranscriptIndexRequest(req('internal'), e as never, logger)).status).toBe(202);
    expect(e.MESSAGE_QUEUE.send).toHaveBeenCalledWith(expect.objectContaining({ type: MessageType.TranscriptIndexSync, payload: expect.objectContaining({ videoId: 'v1', language: 'en' }) }));
  });
});
