/**
 * Story 29.9: the processor applies SearchIndexSync messages and moderation
 * outcomes to the D1 search index.
 */
import { MessageProcessor } from '../messageProcessor';
import { createLogger } from '@al-ummah/logger';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';

describe('search index sync', () => {
  function setup(withSearchDb = true) {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const statement = (sql: string, values: unknown[] = []) => ({
      bind: (...next: unknown[]) => statement(sql, next),
      first: jest.fn(async () => {
        executed.push({ sql, values });
        return null;
      }),
      all: jest.fn(async () => ({ results: [] })),
      run: jest.fn(async () => {
        executed.push({ sql, values });
        return { success: true };
      }),
      sql,
      values,
    });
    const searchDb = {
      prepare: jest.fn((sql: string) => statement(sql)),
      batch: jest.fn(async (statements: Array<{ sql: string; values: unknown[] }>) => {
        statements.forEach(s => executed.push({ sql: s.sql, values: s.values }));
        return statements.map(() => ({ results: [] }));
      }),
    };
    const reportsRun = jest.fn().mockResolvedValue({ success: true });
    const env = {
      MESSAGE_QUEUE: { send: jest.fn() },
      MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) },
      REPORTS_DB: { prepare: jest.fn(() => ({ bind: jest.fn(() => ({ run: reportsRun })) })) },
      ...(withSearchDb ? { SEARCH_DB: searchDb } : {}),
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
    } as unknown as QueueEnvironment;
    const processor = new MessageProcessor(createLogger('processor-test', { logLevel: 'error' }));
    return { env, processor, executed };
  }

  const message = (type: MessageType, payload: Record<string, unknown>): AlUmmahMessage => ({
    id: 'm1',
    type,
    timestamp: new Date().toISOString(),
    payload,
  });

  it('indexes a video that became public', async () => {
    const { env, processor, executed } = setup();
    const video = { id: 'v1', title: 'تفسير سورة الكهف', isPublic: true, channelId: 'c1' };
    const result = await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'video', id: 'v1', object: video }), env);
    expect(result.success).toBe(true);
    const insert = executed.find(e => e.sql.includes('INSERT INTO search_videos_fts'));
    expect(insert?.values[0]).toContain('تفسير سوره الكهف');
    expect(insert?.values[0]).toContain('كهف');
  });

  it('removes a deleted or private item', async () => {
    const { env, processor, executed } = setup();
    await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'playlist', id: 'p1', object: { id: 'p1', name: 'x', isPublic: false } }), env);
    expect(executed.some(e => e.sql.startsWith('DELETE FROM search_playlists WHERE id = ?') && e.values[0] === 'p1')).toBe(true);
  });

  it('rejects malformed messages without retrying', async () => {
    const { env, processor } = setup();
    const result = await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'nope', id: 'x' }), env);
    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(false);
  });

  it('skips quietly when SEARCH_DB is not bound', async () => {
    const { env, processor } = setup(false);
    const result = await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'video', id: 'v1' }), env);
    expect(result.success).toBe(true);
  });

  it('drops content removed by a moderator', async () => {
    const { env, processor, executed } = setup();
    const result = await processor.processMessage(message(MessageType.ReportResolve, {
      reportId: 'r1', entityType: 'video', entityId: 'v9', moderatorId: 'mod', action: 'removed', timestamp: new Date().toISOString(),
    }), env);
    expect(result.success).toBe(true);
    expect(executed.some(e => e.sql.startsWith('DELETE FROM search_videos WHERE id = ?') && e.values[0] === 'v9')).toBe(true);
  });

  it('keeps the ownership index in sync for private videos and deletes', async () => {
    const { env, processor, executed } = setup();
    const video = { id: 'v2', title: 'Draft', isPublic: false, channelId: 'c1', userId: 'u1', scheduledPublishStatus: 'scheduled' };
    await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'video', id: 'v2', object: video }), env);
    const upsert = executed.find(e => e.sql.includes('INSERT INTO content_ownership'));
    expect(upsert?.values.slice(0, 5)).toEqual(['video', 'v2', 'u1', 'c1', 0]);

    await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'channel', id: 'c1' }), env);
    expect(executed.some(e => e.sql.startsWith('DELETE FROM content_ownership') && e.values[1] === 'c1')).toBe(true);
  });

  it('does not touch the ownership index for playlists', async () => {
    const { env, processor, executed } = setup();
    await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'playlist', id: 'p1', object: { id: 'p1', name: 'x' } }), env);
    expect(executed.some(e => e.sql.includes('content_ownership'))).toBe(false);
  });

  it('flags banned content as hidden and deleted in the ownership index', async () => {
    const { env, processor, executed } = setup();
    await processor.processMessage(message(MessageType.ReportResolve, {
      reportId: 'r1', entityType: 'channel', entityId: 'c9', moderatorId: 'mod', action: 'banned', timestamp: new Date().toISOString(),
    }), env);
    const update = executed.find(e => e.sql.startsWith('UPDATE content_ownership'));
    expect(update?.sql).toContain('is_hidden = 1, is_deleted = 1');
    expect(update?.values.slice(1)).toEqual(['channel', 'c9']);
  });

  it('leaves the index alone for warnings', async () => {
    const { env, processor, executed } = setup();
    await processor.processMessage(message(MessageType.ReportResolve, {
      reportId: 'r1', entityType: 'video', entityId: 'v9', moderatorId: 'mod', action: 'warning',
    }), env);
    expect(executed.some(e => e.sql.includes('search_'))).toBe(false);
  });

  it('a failed ownership write is queued for repair (one object) and never marks the index incomplete', async () => {
    const { env, processor, executed } = setup();
    const db = (env as unknown as { SEARCH_DB: { prepare: jest.Mock } }).SEARCH_DB;
    const real = db.prepare.getMockImplementation()!;
    db.prepare.mockImplementation((sql: string) => {
      const st = real(sql);
      if (sql.includes('INSERT INTO content_ownership')) {
        return { ...st, bind: () => ({ ...st, run: async () => { throw new Error('D1 overloaded'); } }) };
      }
      return st;
    });
    const video = { id: 'v1', title: 'x', isPublic: false, channelId: 'c1', userId: 'u1' };
    const result = await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'video', id: 'v1', object: video, version: 5 }), env);
    expect(result.success).toBe(true);
    const repair = executed.find(e => e.sql.includes('INSERT INTO index_repairs'));
    expect(repair?.values.slice(0, 4)).toEqual(['video', 'v1', 'v1', 'ownership-write']);
    expect(executed.some(e => e.sql.includes('DELETE FROM search_meta'))).toBe(false);
    expect(executed.some(e => e.sql.includes('ownership:invalidated'))).toBe(false);
  });

  it('retries the message (queue → DLQ) when the repair cannot be recorded either', async () => {
    const { env, processor } = setup();
    const db = (env as unknown as { SEARCH_DB: { prepare: jest.Mock } }).SEARCH_DB;
    const real = db.prepare.getMockImplementation()!;
    db.prepare.mockImplementation((sql: string) => {
      const st = real(sql);
      if (sql.includes('INSERT INTO content_ownership') || sql.includes('INSERT INTO index_repairs')) {
        return { ...st, bind: () => ({ ...st, run: async () => { throw new Error('D1 down'); } }) };
      }
      return st;
    });
    const result = await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'video', id: 'v1', object: { id: 'v1', title: 'x' } }), env);
    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(true);
  });

  it('a failed search-row write records a repair with the post key', async () => {
    const { env, processor, executed } = setup();
    const db = (env as unknown as { SEARCH_DB: { batch: jest.Mock } }).SEARCH_DB;
    db.batch.mockImplementation(async () => { throw new Error('D1 overloaded'); });
    const post = { id: 'p1', channelId: 'c9', content: 'hello', status: 'published', visibility: 'public' };
    const result = await processor.processMessage(message(MessageType.SearchIndexSync, { entity: 'post', id: 'p1', object: post }), env);
    expect(result.success).toBe(true);
    const repair = executed.find(e => e.sql.includes('INSERT INTO index_repairs'));
    expect(repair?.values.slice(0, 4)).toEqual(['post', 'p1', 'posts/c9/p1.json', 'search-write']);
  });
});
