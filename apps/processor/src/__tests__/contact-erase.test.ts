/**
 * #616: deleting a videos account also deletes its Contact us messages and
 * their staff notes, as its own queued, idempotent, retried step.
 */
import { createLogger } from '@al-ummah/logger';
import { MessageProcessor } from '../messageProcessor';
import { eraseUserContactData, erasureRetryDelaySeconds } from '../contact/erase';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

function reportsDb() {
  const db = createSqliteD1(REPORTS_MIGRATIONS_DIR);
  const now = '2026-11-10T08:00:00.000Z';
  const insert = (id: string, userId: string | null, email: string) =>
    db.raw
      .prepare(
        `INSERT INTO contact_messages (id, status, topic, name, email, message, user_id, locale, ip_hash, created_at, updated_at)
         VALUES (?, 'open', 'general', 'N', ?, 'A message long enough', ?, 'en', 'ip', ?, ?)`,
      )
      .run(id, email, userId, now, now);
  insert('m1', 'user-1', 'one@example.org');
  insert('m2', 'user-1', 'one@example.org');
  insert('m3', 'user-2', 'two@example.org');
  insert('m4', null, 'one@example.org');
  const note = (id: string, messageId: string) =>
    db.raw
      .prepare(`INSERT INTO contact_notes (id, message_id, kind, body, author_id, created_at) VALUES (?, ?, 'reply', 'Hi', 'adm', ?)`)
      .run(id, messageId, now);
  note('n1', 'm1');
  note('n2', 'm1');
  note('n3', 'm3');
  return db;
}

const ids = (db: ReturnType<typeof reportsDb>, table: string) =>
  db.raw.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map((r) => r.id);

describe('eraseUserContactData', () => {
  it("deletes the account's messages and their notes, nobody else's, and is idempotent", async () => {
    const db = reportsDb();
    expect(await eraseUserContactData(db, 'user-1')).toEqual({ messages: 2, notes: 2 });
    expect(ids(db, 'contact_messages')).toEqual(['m3', 'm4']);
    expect(ids(db, 'contact_notes')).toEqual(['n3']);
    expect(await eraseUserContactData(db, 'user-1')).toEqual({ messages: 0, notes: 0 });
  });

  it('refuses an empty user id', async () => {
    await expect(eraseUserContactData(reportsDb(), '')).rejects.toThrow('missing required field');
  });
});

describe('ContactDataErase in the erasure flow', () => {
  const logger = createLogger('processor-test', { logLevel: 'error' });
  const message = (type: MessageType, payload: Record<string, unknown>): AlUmmahMessage => ({ id: 'erase-1', type, timestamp: new Date().toISOString(), payload });

  it('UserDataErased queues the Contact us step on the processor queue', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const run = jest.fn().mockResolvedValue({ meta: { changes: 0 } });
    const env = {
      MESSAGE_QUEUE: { send },
      MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) },
      REPORTS_DB: { prepare: jest.fn(() => ({ bind: jest.fn(() => ({ run })) })), batch: jest.fn().mockResolvedValue([]) },
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
    } as unknown as QueueEnvironment;
    const result = await new MessageProcessor(logger).processMessage(message(MessageType.UserDataErased, { userId: 'user-1' }), env);
    expect(result.success).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'erase-1:contact', type: MessageType.ContactDataErase, payload: { userId: 'user-1' } }));
  });

  it('a failure to queue the step fails the erasure message, so it is retried', async () => {
    const env = {
      MESSAGE_QUEUE: { send: jest.fn().mockRejectedValue(new Error('queue down')) },
      MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) },
      REPORTS_DB: { prepare: jest.fn(), batch: jest.fn() },
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
    } as unknown as QueueEnvironment;
    const result = await new MessageProcessor(logger).processMessage(message(MessageType.UserDataErased, { userId: 'user-1' }), env);
    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(true);
  });

  it('ContactDataErase erases on REPORTS_DB; a D1 failure is retried', async () => {
    const db = reportsDb();
    const env = { MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) }, REPORTS_DB: db, ENVIRONMENT: 'test', LOG_LEVEL: 'error' } as unknown as QueueEnvironment;
    const processor = new MessageProcessor(logger);
    expect((await processor.processMessage(message(MessageType.ContactDataErase, { userId: 'user-1' }), env)).success).toBe(true);
    expect(ids(db, 'contact_messages')).toEqual(['m3', 'm4']);

    const broken = { ...env, REPORTS_DB: { batch: jest.fn().mockRejectedValue(new Error('D1 unavailable')), prepare: jest.fn(() => ({ bind: jest.fn() })) } } as unknown as QueueEnvironment;
    const failed = await processor.processMessage(message(MessageType.ContactDataErase, { userId: 'user-1' }), broken);
    expect(failed.success).toBe(false);
    expect(failed.shouldRetry).toBe(true);
  });

  it('a step without a user id is not retried', async () => {
    const env = { MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) }, REPORTS_DB: reportsDb(), ENVIRONMENT: 'test', LOG_LEVEL: 'error' } as unknown as QueueEnvironment;
    const result = await new MessageProcessor(logger).processMessage(message(MessageType.ContactDataErase, {}), env);
    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(false);
  });
});

describe('erasure retry backoff', () => {
  const types = [MessageType.UserDataErased, MessageType.ContactDataErase];
  it('backs erasure steps off (30 s doubling, capped) and leaves other types alone', () => {
    expect([1, 2, 3, 4, 6].map((a) => erasureRetryDelaySeconds(MessageType.ContactDataErase, a, types))).toEqual([30, 60, 120, 240, 600]);
    expect(erasureRetryDelaySeconds(MessageType.UserDataErased, 1, types)).toBe(30);
    expect(erasureRetryDelaySeconds(MessageType.ReportCreate, 1, types)).toBeUndefined();
  });
});
