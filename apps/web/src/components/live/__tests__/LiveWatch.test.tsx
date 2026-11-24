import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_WATCH_EN, type LiveStreamState } from '@al-ummah/shared-types';
import { LiveWatch, watchMode } from '../LiveWatch';
import type { TimedState } from '@/lib/live/api';

const getStream = jest.fn();
const getState = jest.fn();
const getPublicChannel = jest.fn();
const beatViewer = jest.fn();
const leaveViewer = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { liveWatch: mockText }, lang: 'ar', isRTL: true }) }));
jest.mock('@/lib/live/api', () => {
  const actual = jest.requireActual('@/lib/live/api');
  return {
    ...actual,
    getStream: (...a: unknown[]) => getStream(...a),
    getState: (...a: unknown[]) => getState(...a),
    getPublicChannel: (...a: unknown[]) => getPublicChannel(...a),
    beatViewer: (...a: unknown[]) => beatViewer(...a),
    leaveViewer: (...a: unknown[]) => leaveViewer(...a),
  };
});
jest.mock('../LivePlayer', () => ({ LivePlayer: ({ src, testId }: { src: string; testId: string }) => <div data-testid={testId} data-src={src} /> }));
jest.mock('../LiveChatPanel', () => ({
  LiveChatPanel: (p: { mode: string; canModerate: boolean; onChanged: () => void }) => <button type="button" data-testid="chat" data-mode={p.mode} data-moderate={String(p.canModerate)} onClick={() => p.onChanged()} />,
  LiveChatReplay: () => <div data-testid="chat-replay" />,
}));
jest.mock('../useLiveQoe', () => ({ useLiveQoe: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), debug: jest.fn() } }));

const mockText = LIVE_WATCH_EN;
const base: LiveStreamState = { streamId: 's1', sessionId: 'x', status: 'scheduled', sessionStatus: 'provisioned', receiving: false, playbackUrl: 'https://live/p.m3u8', vodUrl: null, startedAt: null, endedAt: null, bitrateKbps: null };
const timed = (over: Partial<LiveStreamState>): TimedState => ({ state: { ...base, ...over, provider: 'bunny', qoe: { sampleRate: 0.2 } }, sentAt: 0, receivedAt: 0, dateHeader: null });

describe('watchMode', () => {
  it('plays the live URL while live and the recording after', () => {
    expect(watchMode(null)).toBe('soon');
    expect(watchMode(timed({}))).toBe('soon');
    expect(watchMode(timed({ status: 'live', sessionStatus: 'live' }))).toBe('live');
    expect(watchMode(timed({ status: 'ended', sessionStatus: 'ended' }))).toBe('ended');
    expect(watchMode(timed({ status: 'ended', sessionStatus: 'ended', vodUrl: 'https://vod' }))).toBe('recording');
    expect(watchMode(timed({ status: 'cancelled' }))).toBe('cancelled');
  });
});

describe('LiveWatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getStream.mockResolvedValue({ id: 's1', title: 'Friday lecture', status: 'live', channelId: 'c1' });
    getPublicChannel.mockResolvedValue({ id: 'c1', name: 'My channel', handle: 'mine' });
    beatViewer.mockResolvedValue(null);
  });

  it('plays a live stream with the live badge, title and channel', async () => {
    getState.mockResolvedValue(timed({ status: 'live', sessionStatus: 'live' }));
    render(<LiveWatch streamId="s1" />);
    expect(await screen.findByTestId('live-watch-player')).toHaveAttribute('data-src', 'https://live/p.m3u8');
    expect(screen.getByTestId('live-watch-badge')).toHaveTextContent(mockText.live);
    expect(screen.getByTestId('live-watch-title')).toHaveTextContent('Friday lecture');
    expect(await screen.findByTestId('live-watch-channel')).toHaveAttribute('href', '/ar/@mine');
  });

  it('shows Starting soon while scheduled', async () => {
    getState.mockResolvedValue(timed({}));
    render(<LiveWatch streamId="s1" />);
    expect(await screen.findByTestId('live-watch-notice')).toHaveTextContent(mockText.startingSoon);
    expect(screen.queryByTestId('live-watch-player')).toBeNull();
  });

  it('plays the recording after the end', async () => {
    getState.mockResolvedValue(timed({ status: 'ended', sessionStatus: 'ended', vodUrl: 'https://vod/v.m3u8' }));
    render(<LiveWatch streamId="s1" />);
    expect(await screen.findByTestId('live-watch-recording')).toHaveAttribute('data-src', 'https://vod/v.m3u8');
  });

  it('says a missing or private stream is not there', async () => {
    const { LiveApiError } = jest.requireActual('@/lib/live/api');
    getStream.mockRejectedValue(new LiveApiError(404, 'not_found'));
    getState.mockRejectedValue(new LiveApiError(404, 'not_found'));
    render(<LiveWatch streamId="s1" />);
    expect(await screen.findByTestId('live-watch-missing')).toHaveTextContent(mockText.notFound);
  });

  describe('the chat (wiki E17)', () => {
    const CHAT = { enabled: true, replay: false, slowModeSeconds: 0, subscribersOnly: false, canPost: true };
    const withChat = (over: Partial<LiveStreamState>, chat: object, more: object = {}) => {
      const t = timed(over);
      return { ...t, state: { ...t.state, chat: chat as typeof CHAT, ...more } };
    };

    it('is beside a live or coming stream when the server says so, and reads the state again when it changes', async () => {
      getState.mockResolvedValue(withChat({ status: 'live', sessionStatus: 'live' }, CHAT, { canModerate: true }));
      render(<LiveWatch streamId="s1" />);
      const chat = await screen.findByTestId('chat');
      expect(chat).toHaveAttribute('data-mode', 'live');
      expect(chat).toHaveAttribute('data-moderate', 'true');
      // It opens or closes without the player being made again
      const player = screen.getByTestId('live-watch-player');
      getState.mockResolvedValue(withChat({ status: 'live', sessionStatus: 'live' }, { ...CHAT, enabled: false }));
      fireEvent.click(chat);
      await waitFor(() => expect(screen.queryByTestId('chat')).toBeNull());
      expect(screen.getByTestId('live-watch-player')).toBe(player);
    });

    it('replays beside the recording, when there is one', async () => {
      getState.mockResolvedValue(withChat({ status: 'ended', sessionStatus: 'ended', vodUrl: 'https://vod' }, { ...CHAT, enabled: false, replay: true }));
      const { unmount } = render(<LiveWatch streamId="s1" />);
      expect(await screen.findByTestId('chat-replay')).toBeInTheDocument();
      unmount();
      // No recording yet: nothing to replay beside
      getState.mockResolvedValue(withChat({ status: 'ended', sessionStatus: 'ended' }, { ...CHAT, enabled: false, replay: true }));
      render(<LiveWatch streamId="s1" />);
      await screen.findByTestId('live-watch-notice');
      expect(screen.queryByTestId('chat-replay')).toBeNull();
    });

    it('is not on the page while off, and on a server without it', async () => {
      for (const state of [timed({ status: 'live', sessionStatus: 'live' }), withChat({ status: 'live', sessionStatus: 'live' }, { ...CHAT, enabled: false, canPost: false }), withChat({ status: 'cancelled' }, CHAT)]) {
        getState.mockResolvedValue(state);
        const { unmount } = render(<LiveWatch streamId="s1" />);
        await screen.findByTestId('live-watch');
        expect(screen.queryByTestId('chat')).toBeNull();
        expect(screen.queryByTestId('chat-replay')).toBeNull();
        unmount();
      }
    });
  });

  describe('people watching now', () => {
    it('beats while live and shows the count it answers, in the page language', async () => {
      getState.mockResolvedValue(timed({ status: 'live', sessionStatus: 'live', viewers: 3 }));
      beatViewer.mockResolvedValue(12);
      render(<LiveWatch streamId="s1" />);
      const viewers = await screen.findByTestId('live-watch-viewers');
      await waitFor(() => expect(viewers).toHaveAttribute('data-count', '12'));
      expect(viewers).toHaveTextContent('Watching now: ١٢');
      expect(beatViewer).toHaveBeenCalledWith('s1', expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/), expect.anything());
    });

    it('shows the state\'s count until the first beat answers, and nothing when unknown', async () => {
      getState.mockResolvedValue(timed({ status: 'live', sessionStatus: 'live', viewers: 3 }));
      beatViewer.mockReturnValue(new Promise(() => undefined));
      const { unmount } = render(<LiveWatch streamId="s1" />);
      expect(await screen.findByTestId('live-watch-viewers')).toHaveAttribute('data-count', '3');
      unmount();
      expect(leaveViewer).toHaveBeenCalledWith('s1', expect.any(String));

      getState.mockResolvedValue(timed({ status: 'live', sessionStatus: 'live' }));
      render(<LiveWatch streamId="s1" />);
      await screen.findByTestId('live-watch-player');
      expect(screen.queryByTestId('live-watch-viewers')).toBeNull();
    });

    it('does not beat for a recording or a stream not live yet', async () => {
      getState.mockResolvedValue(timed({ status: 'ended', sessionStatus: 'ended', vodUrl: 'https://vod/v.m3u8' }));
      render(<LiveWatch streamId="s1" />);
      await screen.findByTestId('live-watch-recording');
      expect(beatViewer).not.toHaveBeenCalled();
      expect(screen.queryByTestId('live-watch-viewers')).toBeNull();
    });
  });
});
