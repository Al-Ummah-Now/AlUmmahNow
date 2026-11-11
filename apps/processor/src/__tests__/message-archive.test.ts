import { shouldArchiveMessage } from '../messageProcessor';
import { MessageType } from '../types';

describe('MESSAGE_ARCHIVE', () => {
  it('archives every message by default (production)', () => {
    expect(shouldArchiveMessage(MessageType.VideoView, undefined)).toBe(true);
    expect(shouldArchiveMessage(MessageType.VideoView, 'all')).toBe(true);
    expect(shouldArchiveMessage(MessageType.VideoView, 'unexpected')).toBe(true);
  });

  it('keeps only client analytics with "client-analytics" (QA, stage)', () => {
    expect(shouldArchiveMessage(MessageType.ClientAnalyticsEvent, 'client-analytics')).toBe(true);
    expect(shouldArchiveMessage(MessageType.VideoView, 'client-analytics')).toBe(false);
    expect(shouldArchiveMessage(MessageType.WatchHistory, 'client-analytics')).toBe(false);
  });

  it('archives nothing with "off"', () => {
    expect(shouldArchiveMessage(MessageType.ClientAnalyticsEvent, 'off')).toBe(false);
  });
});
