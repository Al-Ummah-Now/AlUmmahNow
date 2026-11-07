/**
 * Story 1.3 AC 2: after a GDPR erasure in api-videos, the processor anonymises
 * the reporter on moderation reports it stored in D1.
 */
import { MessageProcessor, DELETED_USER_ID } from '../messageProcessor';
import { createLogger } from '@al-ummah/logger';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';

describe('UserDataErased', () => {
  function setup() {
    const run = jest.fn().mockResolvedValue({ meta: { changes: 2 } });
    const bind = jest.fn(() => ({ run }));
    const prepare = jest.fn(() => ({ bind }));
    const env = {
      MESSAGE_QUEUE: { send: jest.fn() },
      MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) },
      REPORTS_DB: { prepare },
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
    } as unknown as QueueEnvironment;
    const processor = new MessageProcessor(createLogger('processor-test', { logLevel: 'error' }));
    return { env, processor, prepare, bind, run };
  }

  const message = (payload: Record<string, unknown>): AlUmmahMessage => ({
    id: 'erase-1',
    type: MessageType.UserDataErased,
    timestamp: new Date().toISOString(),
    payload,
  });

  it('replaces the reporter id with the tombstone', async () => {
    const { env, processor, prepare, bind, run } = setup();
    const result = await processor.processMessage(message({ userId: 'user-123', timestamp: new Date().toISOString() }), env);
    expect(result.success).toBe(true);
    expect(prepare).toHaveBeenCalledWith('UPDATE reports SET reporter_id = ? WHERE reporter_id = ?');
    expect(bind).toHaveBeenCalledWith(DELETED_USER_ID, 'user-123');
    expect(run).toHaveBeenCalled();
  });

  it('rejects messages without a user id', async () => {
    const { env, processor, prepare } = setup();
    const result = await processor.processMessage(message({}), env);
    expect(result.success).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });
});
