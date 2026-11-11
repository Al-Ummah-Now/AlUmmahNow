import { render, screen } from '@testing-library/react';
import { LIVE_WATCH_EN, type LiveStreamState } from '@al-ummah/shared-types';
import { LiveWatch, watchMode } from '../LiveWatch';
import type { TimedState } from '@/lib/live/api';

const getStream = jest.fn();
const getState = jest.fn();
const getPublicChannel = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { liveWatch: mockText }, lang: 'ar', isRTL: true }) }));
jest.mock('@/lib/live/api', () => {
  const actual = jest.requireActual('@/lib/live/api');
  return {
    ...actual,
    getStream: (...a: unknown[]) => getStream(...a),
    getState: (...a: unknown[]) => getState(...a),
    getPublicChannel: (...a: unknown[]) => getPublicChannel(...a),
  };
});
jest.mock('../LivePlayer', () => ({ LivePlayer: ({ src, testId }: { src: string; testId: string }) => <div data-testid={testId} data-src={src} /> }));
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
});
