/**
 * ReportResolve mirrors an admin moderation decision into D1. admin-api has
 * already written the row, so the processor must not turn a dismissal into a
 * resolution or erase the moderator's notes (regression found by the
 * admin-web Playwright suite).
 */
import { MessageProcessor } from '../messageProcessor';
import { createLogger } from '@al-ummah/logger';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';

describe('ReportResolve', () => {
  function setup() {
    const run = jest.fn().mockResolvedValue({ meta: { changes: 1 } });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed params so mock.calls is typed
    const bind = jest.fn((..._args: unknown[]) => ({ run }));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed params so mock.calls is typed
    const prepare = jest.fn((_sql: string) => ({ bind }));
    const env = {
      MESSAGE_QUEUE: { send: jest.fn() },
      MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) },
      REPORTS_DB: { prepare },
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
    } as unknown as QueueEnvironment;
    const processor = new MessageProcessor(createLogger('processor-test', { logLevel: 'error' }));
    return { env, processor, prepare, bind };
  }

  const message = (payload: Record<string, unknown>): AlUmmahMessage => ({
    id: 'resolve-1',
    type: MessageType.ReportResolve,
    timestamp: new Date().toISOString(),
    payload: {
      reportId: 'r-1',
      entityType: 'comment',
      entityId: 'c-1',
      moderatorId: 'mod-1',
      timestamp: new Date().toISOString(),
      ...payload,
    },
  });

  it('keeps a dismissal dismissed and preserves stored notes when none are sent', async () => {
    const { env, processor, prepare, bind } = setup();
    const result = await processor.processMessage(message({ action: 'dismissed', status: 'dismissed' }), env);
    expect(result.success).toBe(true);
    const sql = prepare.mock.calls.map((call) => call[0]).find((q) => q.includes('UPDATE reports'));
    expect(sql).toContain('COALESCE(?, moderator_notes)');
    const args = bind.mock.calls[bind.mock.calls.length - 1];
    expect(args[0]).toBe('dismissed');
    expect(args[3]).toBeNull();
  });

  it('derives the status from the action for messages without a status', async () => {
    const { env, processor, bind } = setup();
    await processor.processMessage(message({ action: 'dismissed' }), env);
    expect(bind.mock.calls[bind.mock.calls.length - 1][0]).toBe('dismissed');
    await processor.processMessage(message({ action: 'removed', moderatorNotes: 'spam' }), env);
    const args = bind.mock.calls[bind.mock.calls.length - 1];
    expect(args[0]).toBe('resolved');
    expect(args[3]).toBe('spam');
  });
});
