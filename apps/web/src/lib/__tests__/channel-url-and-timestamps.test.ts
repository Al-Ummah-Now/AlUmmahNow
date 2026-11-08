import { channelPath, formatHandle, handleRewritePath, localHandleProblem } from '@/lib/channel-url';
import { dispatchPlayerSeek, parseCommentTimestamps, PLAYER_SEEK_EVENT } from '@/lib/video/comment-timestamps';

describe('channel URLs', () => {
  it('rewrites /{locale}/@handle (and %40) to the c/[handle] route', () => {
    expect(handleRewritePath('/en/@Noor.TV')).toEqual({ locale: 'en', handle: 'Noor.TV', path: '/en/c/Noor.TV' });
    expect(handleRewritePath('/ar/%40noor/')).toEqual({ locale: 'ar', handle: 'noor', path: '/ar/c/noor' });
    expect(handleRewritePath('/en/channels/abc')).toBeNull();
    expect(handleRewritePath('/en/@noor/videos')).toBeNull();
  });

  it('prefers the handle URL and falls back to the id URL', () => {
    expect(channelPath('en', { id: 'c1', handle: 'Noor' })).toBe('/en/@Noor');
    expect(channelPath('ar', { id: 'c1' })).toBe('/ar/channels/c1');
    expect(channelPath('en', { id: 'c1', handle: 'Noor' }, 'about')).toBe('/en/@Noor?tab=about');
    expect(formatHandle('Noor')).toBe('@Noor');
    expect(formatHandle(undefined)).toBe('');
  });

  it('mirrors the API format rules', () => {
    expect(localHandleProblem('ab')).toBe('too_short');
    expect(localHandleProblem('a'.repeat(31))).toBe('too_long');
    expect(localHandleProblem('bad handle')).toBe('invalid_characters');
    expect(localHandleProblem('_lead')).toBe('invalid_characters');
    expect(localHandleProblem('@good.one')).toBeNull();
  });
});

describe('comment timestamps', () => {
  it('turns m:ss and h:mm:ss into seek segments', () => {
    expect(parseCommentTimestamps('see 1:05 and 1:02:03!')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'timestamp', value: '1:05', seconds: 65 },
      { type: 'text', value: ' and ' },
      { type: 'timestamp', value: '1:02:03', seconds: 3723 },
      { type: 'text', value: '!' },
    ]);
  });

  it('ignores out-of-range fields and longer numbers', () => {
    expect(parseCommentTimestamps('12:75 1:2345 a12:30')).toEqual([{ type: 'text', value: '12:75 1:2345 a12:30' }]);
    expect(parseCommentTimestamps('1:75:00')).toEqual([{ type: 'text', value: '1:75:00' }]);
  });

  it('skips timestamps past the video duration when known', () => {
    expect(parseCommentTimestamps('at 9:00', 120).some((s) => s.type === 'timestamp')).toBe(false);
  });

  it('dispatches the player seek event', () => {
    const handler = jest.fn();
    window.addEventListener(PLAYER_SEEK_EVENT, handler);
    dispatchPlayerSeek({ videoId: 'v1', seconds: 42 });
    window.removeEventListener(PLAYER_SEEK_EVENT, handler);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ videoId: 'v1', seconds: 42 });
  });
});
