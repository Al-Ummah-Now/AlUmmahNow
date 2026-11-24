import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { LIVE_WATCH_AR, LIVE_WATCH_EN } from '@al-ummah/shared-types';
import { PremiereCountdown } from '../PremiereCountdown';
import { PremierePlayer, VIDEO_RETRY_MS } from '../PremierePlayer';
import { ReminderButton } from '../ReminderButton';
import { LiveApiError } from '@/lib/live/api';
import { RESYNC_SECONDS, premierePosition, serverOffset, usePremiereSync, type PremiereClock, type SyncedPlayer } from '../premiere-clock';

const fetchVideoById = jest.fn();
const setReminder = jest.fn();
let mockUser: { id: string } | null = { id: 'u1' };
let mockLang: 'en' | 'ar' = 'en';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { liveWatch: mockLang === 'ar' ? mockAr : mockEn }, lang: mockLang, isRTL: mockLang === 'ar' }) }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/api/videos', () => ({ fetchVideoById: (...a: unknown[]) => fetchVideoById(...a) }));
jest.mock('@/lib/live/api', () => ({ ...jest.requireActual('@/lib/live/api'), setReminder: (...a: unknown[]) => setReminder(...a) }));
jest.mock('@/components/VideoPagePlayer/VideoPlayerWithChapters', () => ({ VideoPlayerWithChapters: (p: { videoId: string; startTime?: number; autoplayIntent?: boolean }) => <div data-testid="video" data-id={p.videoId} data-start={p.startTime} data-auto={String(p.autoplayIntent)} /> }));
jest.mock('@/components/VideoPagePlayer/useDeliveryPlayback', () => ({ useDeliveryPlayback: () => ({ videoSources: [], posterUrl: '', handlePlayerReady: jest.fn(), handlePlaybackError: jest.fn() }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), debug: jest.fn() } }));
const mockEn = LIVE_WATCH_EN;
const mockAr = LIVE_WATCH_AR;

/** A player that does what it is told; `advance` is the time that passes. */
function fakePlayer() {
  const on = new Map<string, Set<() => void>>();
  const s = { at: 0, rate: 1, paused: true, ready: 4, seeks: [] as number[] };
  const emit = (e: string) => act(() => on.get(e)?.forEach((fn) => fn()));
  const player = {
    currentTime: (to?: number) => {
      if (to === undefined) return s.at;
      s.at = to;
      s.seeks.push(to);
      return undefined;
    },
    playbackRate: (to?: number) => (to === undefined ? s.rate : void (s.rate = to)),
    paused: () => s.paused,
    seeking: () => false,
    ended: () => false,
    readyState: () => s.ready,
    play: () => void (s.paused = false),
    on: (e: string, fn: () => void) => void (on.get(e) ?? on.set(e, new Set()).get(e)!).add(fn),
    off: (e: string, fn: () => void) => void on.get(e)?.delete(fn),
  } as unknown as SyncedPlayer;
  return { player, s, emit, listeners: () => [...on.values()].reduce((n, set) => n + set.size, 0) };
}

const NOW = Date.parse('2026-11-24T18:00:00Z');
const clock = (over: Partial<PremiereClock> = {}): PremiereClock => ({ startedAt: NOW - 100_000, offset: 0, duration: 600, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
  mockUser = { id: 'u1' };
  mockLang = 'en';
});
afterEach(() => jest.useRealTimers());

describe('the moment of a premiere', () => {
  it('is the server’s time since the start, within the video', () => {
    expect(premierePosition(NOW - 90_000, 0, 600, NOW)).toBe(90);
    // A device whose clock is 20 s slow
    expect(premierePosition(NOW - 90_000, 20_000, 600, NOW)).toBe(110);
    expect(premierePosition(NOW + 5_000, 0, 600, NOW)).toBe(0);
    expect(premierePosition(NOW - 900_000, 0, 600, NOW)).toBe(600);
    expect(serverOffset(null)).toBe(0);
    expect(serverOffset({ state: { serverNow: NOW + 3_050 } as never, sentAt: NOW, receivedAt: NOW + 100, dateHeader: null })).toBe(3_000);
  });
});

describe('following it', () => {
  const start = (c: PremiereClock | null = clock()) => {
    const f = fakePlayer();
    const hook = renderHook(({ value }) => usePremiereSync(f.player, value), { initialProps: { value: c } });
    return { ...f, hook };
  };
  /** Playing for a while at normal speed */
  const play = (f: ReturnType<typeof start>, ms: number) => {
    for (let passed = 0; passed < ms; passed += 1_000) {
      if (!f.s.paused && f.s.ready >= 3) f.s.at += 1;
      act(() => void jest.advanceTimersByTime(1_000));
    }
  };

  it('starts at the moment and comes back to it when it drifts more than 3 seconds', () => {
    const f = start();
    expect(f.s.at).toBe(100);
    f.s.paused = false;
    f.emit('playing');
    play(f, 5_000);
    expect(f.s.seeks).toEqual([100]);
    // Buffering: not while there is nothing to play, and then at once
    f.s.at -= RESYNC_SECONDS + 1;
    f.s.ready = 2;
    play(f, 1_000);
    expect(f.s.seeks).toEqual([100]);
    f.s.ready = 4;
    play(f, 1_000);
    expect(f.s.seeks).toEqual([100, 107]);
    expect(f.hook.result.current.behind).toBe(false);
  });

  it('a small drift is left alone, and playing faster is not possible', () => {
    const f = start();
    f.s.paused = false;
    f.emit('playing');
    f.s.at -= 2;
    f.s.rate = 2;
    play(f, 1_000);
    expect(f.s.seeks).toEqual([100]);
    expect(f.s.rate).toBe(1);
  });

  it('nobody gets ahead of it', () => {
    const f = start();
    f.s.paused = false;
    f.emit('playing');
    f.s.at = 400;
    f.emit('seeking');
    expect(f.s.at).toBe(100);
    expect(f.hook.result.current.behind).toBe(false);
  });

  it('a viewer who goes back stays there until they return', () => {
    const f = start();
    f.s.paused = false;
    f.emit('playing');
    f.s.at = 40;
    f.emit('seeking');
    expect(f.hook.result.current.behind).toBe(true);
    f.s.rate = 1.5;
    play(f, 4_000);
    expect(f.s.at).toBe(44);
    // Catching up may be faster
    expect(f.s.rate).toBe(1.5);
    act(() => f.hook.result.current.returnToLive());
    expect(f.s.at).toBe(104);
    play(f, 1_000);
    expect(f.hook.result.current.behind).toBe(false);
    expect(f.s.rate).toBe(1);
  });

  it('a viewer who catches up past the moment between two ticks is brought back to it, at normal speed', () => {
    const f = start();
    f.s.paused = false;
    f.emit('playing');
    f.s.at = 90;
    f.emit('seeking');
    expect(f.hook.result.current.behind).toBe(true);
    f.s.rate = 2;
    // A background tab: one tick after 20 s. Behind by 10 s before it, ahead by 10 s after it
    act(() => void jest.setSystemTime(Date.now() + 19_000));
    f.s.at += 39;
    play(f, 1_000);
    expect(f.s.at).toBe(120);
    expect(f.s.rate).toBe(1);
    expect(f.hook.result.current.behind).toBe(false);
    play(f, 3_000);
    expect(f.s.at).toBe(123);
  });

  it('a pause is the viewer’s too, but not the one before it has played', () => {
    const f = start();
    f.emit('pause');
    f.s.paused = false;
    f.emit('playing');
    f.s.paused = true;
    f.emit('pause');
    play(f, 10_000);
    expect(f.hook.result.current.behind).toBe(true);
    act(() => f.hook.result.current.returnToLive());
    expect(f.s.paused).toBe(false);
    expect(f.s.at).toBe(110);
  });

  it('lets go when the video or the premiere is over', () => {
    const f = start(clock({ startedAt: NOW - 595_000 }));
    f.s.paused = false;
    f.emit('playing');
    play(f, 10_000);
    const seeks = f.s.seeks.length;
    f.s.at = 10;
    f.emit('seeking');
    play(f, 2_000);
    expect(f.s.seeks).toHaveLength(seeks);
    f.hook.rerender({ value: null as never });
    expect(f.listeners()).toBe(0);
    expect(f.hook.result.current.behind).toBe(false);
  });
});

describe('the video', () => {
  it('is asked for again until it is released, and starts at the moment', async () => {
    fetchVideoById.mockResolvedValueOnce(undefined).mockResolvedValue({ id: 'v1' });
    render(<PremierePlayer videoId="v1" clock={clock()} onPlayer={jest.fn()} onGone={jest.fn()} />);
    expect(screen.getByTestId('premiere-loading')).toBeInTheDocument();
    await act(async () => { await jest.advanceTimersByTimeAsync(VIDEO_RETRY_MS); });
    const video = screen.getByTestId('video');
    expect(video).toHaveAttribute('data-start', '105');
    expect(video).toHaveAttribute('data-auto', 'true');
  });

  it('says it is gone when it is over and cannot be read', async () => {
    fetchVideoById.mockResolvedValue(undefined);
    const onGone = jest.fn();
    render(<PremierePlayer videoId="v1" clock={null} onPlayer={jest.fn()} onGone={onGone} />);
    await act(async () => { await jest.advanceTimersByTimeAsync(10); });
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(fetchVideoById).toHaveBeenCalledTimes(1);
  });

  it('is the same player after the end', async () => {
    fetchVideoById.mockResolvedValue({ id: 'v1' });
    const props = { videoId: 'v1', onPlayer: jest.fn(), onGone: jest.fn() };
    const { rerender } = render(<PremierePlayer {...props} clock={clock()} />);
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    const video = screen.getByTestId('video');
    rerender(<PremierePlayer {...props} clock={null} />);
    expect(screen.getByTestId('video')).toBe(video);
    expect(video).toHaveAttribute('data-start', '100');
  });
});

describe('the countdown', () => {
  it('runs by the server’s clock, in the page’s digits, and says when it is due', () => {
    mockLang = 'ar';
    const onDue = jest.fn();
    render(<PremiereCountdown startsAt={NOW + 3_725_000} offset={5_000} onDue={onDue} />);
    expect(screen.getByRole('timer')).toHaveTextContent('١:٠٢:٠٠');
    act(() => void jest.advanceTimersByTime(3_720_000));
    expect(screen.getByTestId('premiere-starting')).toHaveTextContent(LIVE_WATCH_AR.premiereStarting);
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it('counts days when they are many', () => {
    render(<PremiereCountdown startsAt={NOW + 3 * 86_400_000 + 1000} offset={0} onDue={jest.fn()} />);
    expect(screen.getByTestId('premiere-countdown')).toHaveTextContent('Premieres in 3 days');
  });
});

describe('the reminder', () => {
  const view = { enabled: true, count: 34, set: false };
  beforeEach(() => jest.useRealTimers());

  it('is set and taken back, with the count as the server has it', async () => {
    setReminder.mockResolvedValueOnce({ set: true, count: 35 }).mockResolvedValueOnce({ set: false, count: 34 });
    render(<ReminderButton streamId="s1" reminder={view} onChanged={jest.fn()} />);
    const button = screen.getByTestId('live-reminder-button');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    expect(setReminder).toHaveBeenLastCalledWith('s1', true);
    expect(screen.getByTestId('live-reminder-count')).toHaveTextContent('35 people asked to be reminded');
    expect(screen.getByText(LIVE_WATCH_EN.reminderWhen)).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
    expect(setReminder).toHaveBeenLastCalledWith('s1', false);
  });

  it('a stream that has started reads the state again; another failure is said', async () => {
    const onChanged = jest.fn();
    setReminder.mockRejectedValueOnce(new LiveApiError(404, 'feature_off')).mockRejectedValueOnce(new LiveApiError(503, 'service_unavailable'));
    render(<ReminderButton streamId="s1" reminder={view} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId('live-reminder-button'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('live-reminder-button')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByTestId('live-reminder-button'));
    expect(await screen.findByText(LIVE_WATCH_EN.reminderFailed)).toBeInTheDocument();
  });
});
