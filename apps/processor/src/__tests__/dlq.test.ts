import { createLogger } from '@al-ummah/logger';
import worker, { handleDeadLetterRequest, runScheduled } from '../index';
import { isDeadLetterQueue, processDeadLetterBatch } from '../dlq/consumer';
import { DEAD_LETTER_MAX_BODY, DEAD_LETTER_RETENTION_MS, listDeadLetters, replayDeadLetter } from '../dlq/store';
import { MessageType, type AlUmmahMessage, type QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const logger = createLogger('dlq-test', { logLevel: 'error' });

function queueMessage(id: string, body: unknown, attempts = 1) {
  return { id, body, attempts, ack: jest.fn(), retry: jest.fn() };
}

function videoMessage(overrides: Partial<AlUmmahMessage> = {}): AlUmmahMessage {
  return { id: 'm-1', type: MessageType.ChannelTabUpdate, timestamp: 1_700_000_000_000, payload: { channelId: 'c1' }, ...overrides };
}

describe('isDeadLetterQueue', () => {
  it.each([
    ['al-ummah-now-dlq', true],
    ['al-ummah-now-dlq-qa', true],
    ['al-ummah-now-dlq-stage', true],
    ['al-ummah-now-videos-qa', false],
    ['al-ummah-now-moderation', false],
    [undefined, false],
  ])('%s -> %s', (queue, expected) => {
    expect(isDeadLetterQueue(queue)).toBe(expected);
  });
});

describe('processDeadLetterBatch', () => {
  it('stores each dead letter, logs an alert and acks', async () => {
    const db = createSqliteD1();
    const errorSpy = jest.spyOn(logger, 'error');
    const msg = queueMessage('q-1', videoMessage({ failureReason: 'boom' }), 1);
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [msg] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'qa' }, logger, 1000);

    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[DLQ] Message dead-lettered', expect.objectContaining({ alert: 'queue_dead_letter', type: 'ChannelTabUpdate', dlq: 'al-ummah-now-dlq-qa' }));
    const [row] = await listDeadLetters(db);
    expect(row).toEqual(
      expect.objectContaining({ id: 'q-1', message_id: 'm-1', message_type: MessageType.ChannelTabUpdate, type_name: 'ChannelTabUpdate', source: 'videos', failure_reason: 'boom', received_at: 1000, replayed_at: null })
    );
    errorSpy.mockRestore();
  });

  it('classifies moderation scans and odd bodies', async () => {
    const db = createSqliteD1();
    const scan = queueMessage('q-2', { id: 's-1', type: MessageType.ModerationScan, timestamp: 1, payload: {} });
    const legacy = queueMessage('q-3', { type: 'SCHEDULER_METRICS', processed: 1 });
    const junk = queueMessage('q-4', 'not an object');
    const job = queueMessage('q-5', { id: 'j-1', type: MessageType.AdminJob, timestamp: 1, payload: { jobId: 'job_1' } });
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq', messages: [scan, legacy, junk, job] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'production' }, logger, 5);
    const rows = await listDeadLetters(db);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['q-2']).toEqual(expect.objectContaining({ source: 'moderation', type_name: 'ModerationScan' }));
    expect(byId['q-5']).toEqual(expect.objectContaining({ source: 'admin-jobs', type_name: 'AdminJob' }));
    expect(byId['q-3']).toEqual(expect.objectContaining({ source: 'videos', type_name: 'SCHEDULER_METRICS', message_type: null }));
    expect(byId['q-4']).toEqual(expect.objectContaining({ type_name: 'unknown', body_json: '"not an object"' }));
  });

  it('is idempotent on redelivery', async () => {
    const db = createSqliteD1();
    const env = { NOTIFICATIONS_DB: db, ENVIRONMENT: 'qa' };
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('q-1', videoMessage())] }, env, logger, 1);
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('q-1', videoMessage(), 2)] }, env, logger, 2);
    expect(await listDeadLetters(db)).toHaveLength(1);
  });

  it('keeps the message in the DLQ when it cannot be stored', async () => {
    const unbound = queueMessage('q-1', videoMessage());
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [unbound] }, { ENVIRONMENT: 'qa' }, logger);
    expect(unbound.retry).toHaveBeenCalled();
    expect(unbound.ack).not.toHaveBeenCalled();

    const failing = queueMessage('q-2', videoMessage());
    const brokenDb = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1 down'); } }) }) } as unknown as QueueEnvironment['NOTIFICATIONS_DB'];
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [failing] }, { NOTIFICATIONS_DB: brokenDb, ENVIRONMENT: 'qa' }, logger);
    expect(failing.retry).toHaveBeenCalled();
  });

  it('truncates very large bodies and refuses to replay them', async () => {
    const db = createSqliteD1();
    const big = videoMessage({ payload: { blob: 'x'.repeat(DEAD_LETTER_MAX_BODY + 10) } });
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('q-big', big)] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'qa' }, logger);
    const [row] = await listDeadLetters(db);
    expect(row?.body_truncated).toBe(1);
    expect(row?.body_json.length).toBe(DEAD_LETTER_MAX_BODY);
    const queue = { send: jest.fn() };
    expect(await replayDeadLetter(db, queue, 'q-big')).toEqual(expect.objectContaining({ status: 'not_replayable' }));
    expect(queue.send).not.toHaveBeenCalled();
  });
});

describe('replayDeadLetter', () => {
  async function seeded(body: unknown = videoMessage({ failureReason: 'x', retryCount: 3, failedAt: 'then' }), id = 'q-1') {
    const db = createSqliteD1();
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage(id, body)] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'qa' }, logger, 1);
    return db;
  }

  it('re-sends the original message once, without failure bookkeeping', async () => {
    const db = await seeded();
    const queue = { send: jest.fn().mockResolvedValue(undefined) };
    expect(await replayDeadLetter(db, queue, 'q-1', 50)).toEqual({ status: 'replayed', messageId: 'm-1' });
    expect(queue.send).toHaveBeenCalledWith({ id: 'm-1', type: MessageType.ChannelTabUpdate, timestamp: 1_700_000_000_000, payload: { channelId: 'c1' } });
    expect(await replayDeadLetter(db, queue, 'q-1', 60)).toEqual({ status: 'already_replayed' });
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(await listDeadLetters(db)).toHaveLength(0);
    expect((await listDeadLetters(db, { includeReplayed: true }))[0]?.replayed_at).toBe(50);
  });

  it('releases the claim when the send fails', async () => {
    const db = await seeded();
    const failing = { send: jest.fn().mockRejectedValue(new Error('queue down')) };
    await expect(replayDeadLetter(db, failing, 'q-1')).rejects.toThrow('queue down');
    const ok = { send: jest.fn().mockResolvedValue(undefined) };
    expect((await replayDeadLetter(db, ok, 'q-1')).status).toBe('replayed');
  });

  it('refuses moderation scans, unknown ids and non-messages', async () => {
    const queue = { send: jest.fn() };
    const scanDb = await seeded({ id: 's', type: MessageType.ModerationScan, timestamp: 1, payload: {} });
    expect((await replayDeadLetter(scanDb, queue, 'q-1')).status).toBe('not_replayable');
    expect((await replayDeadLetter(scanDb, queue, 'nope')).status).toBe('not_found');
    // Admin jobs are retried from admin (the job's Retry), which resets the job row too
    const jobDb = await seeded({ id: 'j', type: MessageType.AdminJob, timestamp: 1, payload: { jobId: 'job_1' } });
    expect((await replayDeadLetter(jobDb, queue, 'q-1')).status).toBe('not_replayable');
    const legacyDb = await seeded({ type: 'SCHEDULER_METRICS' });
    expect((await replayDeadLetter(legacyDb, queue, 'q-1')).status).toBe('not_replayable');
    expect(queue.send).not.toHaveBeenCalled();
  });
});

describe('processor worker DLQ wiring', () => {
  function env(db: ReturnType<typeof createSqliteD1>, overrides: Partial<QueueEnvironment> = {}): QueueEnvironment {
    return {
      MESSAGE_QUEUE: { send: jest.fn().mockResolvedValue(undefined) },
      MESSAGES_BUCKET: { put: jest.fn(), get: jest.fn().mockResolvedValue(null), list: jest.fn() },
      community_posts: { put: jest.fn(), get: jest.fn(), list: jest.fn() },
      REPORTS_DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) }) } as unknown as QueueEnvironment['REPORTS_DB'],
      NOTIFICATIONS_DB: db,
      ENVIRONMENT: 'qa',
      LOG_LEVEL: 'error',
      INTERNAL_API_KEY: 'secret',
      ...overrides,
    };
  }

  it('routes DLQ batches to the dead-letter store instead of processing them', async () => {
    const db = createSqliteD1();
    const e = env(db);
    const msg = queueMessage('q-1', videoMessage());
    await worker.queue({ queue: 'al-ummah-now-dlq-qa', messages: [msg] } as never, e);
    expect(msg.ack).toHaveBeenCalled();
    expect(e.MESSAGES_BUCKET.put).not.toHaveBeenCalled();
    expect(await listDeadLetters(db)).toHaveLength(1);
  });

  it('protects the dead-letter API with INTERNAL_API_KEY and replays through it', async () => {
    const db = createSqliteD1();
    const e = env(db);
    await worker.queue({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('q-1', videoMessage())] } as never, e);
    const call = (path: string, init: RequestInit = {}) => handleDeadLetterRequest(new Request(`https://p${path}`, init), new URL(`https://p${path}`), e, logger);

    expect((await call('/dlq')).status).toBe(401);
    expect((await call('/dlq', { headers: { 'X-API-Key': 'wrong!' } })).status).toBe(401);

    const list = await call('/dlq', { headers: { 'X-API-Key': 'secret' } });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { deadLetters: unknown[] }).deadLetters).toHaveLength(1);

    const replay = await call('/dlq/replay', { method: 'POST', headers: { 'X-API-Key': 'secret' }, body: JSON.stringify({ id: 'q-1' }) });
    expect(replay.status).toBe(200);
    expect(e.MESSAGE_QUEUE?.send).toHaveBeenCalledTimes(1);
    const again = await call('/dlq/replay', { method: 'POST', headers: { 'X-API-Key': 'secret' }, body: JSON.stringify({ id: 'q-1' }) });
    expect(again.status).toBe(409);
    expect((await call('/dlq/replay', { method: 'POST', headers: { 'X-API-Key': 'secret' }, body: '{}' })).status).toBe(400);
  });

  it('purges dead letters past retention on the daily cron', async () => {
    const db = createSqliteD1();
    const now = 100 * DEAD_LETTER_RETENTION_MS;
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('old', videoMessage())] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'qa' }, logger, now - DEAD_LETTER_RETENTION_MS - 1);
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('new', videoMessage())] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'qa' }, logger, now - 1000);
    await runScheduled(env(db), now);
    expect((await listDeadLetters(db)).map((r) => r.id)).toEqual(['new']);
  });
});

describe('dead letters flag the admin Errors page', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('reports a needs-action item with a Replay action, and resolves it when replayed', async () => {
    const posts: Array<{ url: string; key: string | null; body: { events?: Array<{ kind: string; action?: Record<string, unknown> }>; resolved?: Array<{ key: string }> } }> = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(url), key: new Headers(init?.headers).get('X-API-Key'), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const db = createSqliteD1();
    const e = {
      MESSAGE_QUEUE: { send: jest.fn().mockResolvedValue(undefined) },
      NOTIFICATIONS_DB: db,
      ENVIRONMENT: 'qa',
      LOG_LEVEL: 'error',
      INTERNAL_API_KEY: 'secret',
      ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors',
    } as unknown as QueueEnvironment;

    await worker.queue({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('q-9', videoMessage({ failureReason: 'D1 down' }), 4)] } as never, e, ctx);
    await Promise.all(pending);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('https://admin.api.qa.example/internal/errors');
    expect(posts[0].key).toBe('secret');
    const event = posts[0].body.events![0];
    expect(event.kind).toBe('action');
    expect(event.action).toEqual(
      expect.objectContaining({
        key: 'dlq:q-9',
        source: 'dlq',
        retry: { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id: 'q-9' } },
        retryLabel: 'Replay message',
      })
    );

    const res = await handleDeadLetterRequest(
      new Request('https://p/dlq/replay', { method: 'POST', headers: { 'X-API-Key': 'secret' }, body: JSON.stringify({ id: 'q-9' }) }),
      new URL('https://p/dlq/replay'),
      e,
      logger,
      ctx
    );
    expect(res.status).toBe(200);
    await Promise.all(pending);
    expect(posts[1].body.resolved).toEqual([{ key: 'dlq:q-9' }]);
  });

  it('stores a Contact us mail failure without a second item (admin-api flags it with its own Retry)', async () => {
    const fetchMock = jest.fn(async () => new Response(null, { status: 202 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const e = {
      NOTIFICATIONS_DB: createSqliteD1(),
      ENVIRONMENT: 'qa',
      LOG_LEVEL: 'error',
      INTERNAL_API_KEY: 'secret',
      ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors',
    } as unknown as QueueEnvironment;
    const body = { id: 'contact-ack-cm1', type: 'contact_mail', failureReason: 'refused', job: { v: 1, kind: 'ack', messageId: 'cm1' } };
    await worker.queue({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('q-c1', body as never, 1)] } as never, e, ctx);
    await Promise.all(pending);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores a playlist-add dead letter without a second item (api-videos flags it with its own Retry)', async () => {
    const fetchMock = jest.fn(async () => new Response(null, { status: 202 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const db = createSqliteD1();
    const e = {
      NOTIFICATIONS_DB: db,
      ENVIRONMENT: 'qa',
      LOG_LEVEL: 'error',
      INTERNAL_API_KEY: 'secret',
      ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors',
    } as unknown as QueueEnvironment;
    const body = { kind: 'playlist-add', videoId: 'v1', playlistId: 'p1', loopId: 'l1' };
    await worker.queue({ queue: 'al-ummah-now-dlq-qa', messages: [queueMessage('q-pa1', body as never, 6)] } as never, e, ctx);
    await Promise.all(pending);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers a crash of the fetch handler with a reference, not the error', async () => {
    global.fetch = jest.fn(async () => new Response(null, { status: 202 })) as typeof fetch;
    const res = await worker.fetch(new Request('https://p/health'), null as unknown as QueueEnvironment, { waitUntil: () => undefined });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { reference: string; error: string };
    expect(body.reference).toMatch(/^ERR-/);
    expect(JSON.stringify(body)).not.toMatch(/TypeError|Cannot read/);
  });
});
