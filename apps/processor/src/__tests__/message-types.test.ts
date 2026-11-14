/**
 * Queue message types are routed by value: two types sharing a value send one's messages to the
 * other's handler (2026-11-14: ReviewAlert and QuranContentSync were both 260, so the Quran sync
 * took every review alert). Every value must be unique, and a review-alerts batch must reach its
 * consumer whatever its type value.
 */
jest.mock('../review-alerts/consumer', () => ({ processReviewAlertBatch: jest.fn(async () => undefined) }));
jest.mock('../quran/sync', () => ({ ...jest.requireActual('../quran/sync'), processQuranSyncMessages: jest.fn(async () => undefined) }));

import { MessageType } from '@al-ummah/shared-types';
import { processReviewAlertBatch } from '../review-alerts/consumer';
import { processQuranSyncMessages } from '../quran/sync';
import worker from '../index';

describe('queue message types', () => {
  it('every MessageType value is unique', () => {
    const byValue = new Map<number, string[]>();
    for (const [name, value] of Object.entries(MessageType)) {
      if (typeof value !== 'number') continue;
      byValue.set(value, [...(byValue.get(value) ?? []), name]);
    }
    const shared = [...byValue.entries()].filter(([, names]) => names.length > 1).map(([v, names]) => `${v}: ${names.join(', ')}`);
    expect(shared).toEqual([]);
  });

  it('a review-alerts batch reaches the review-alerts consumer, never a type-routed handler', async () => {
    const message = { id: 'm', timestamp: new Date(), attempts: 1, body: { id: 'a', type: MessageType.ReviewAlert, timestamp: 0, payload: {} }, ack: jest.fn(), retry: jest.fn() };
    await worker.queue({ queue: 'al-ummah-now-review-alerts', messages: [message] } as never, {} as never, { waitUntil: () => undefined } as never);
    expect(processReviewAlertBatch).toHaveBeenCalledTimes(1);
    expect(processQuranSyncMessages).not.toHaveBeenCalled();
  });
});
