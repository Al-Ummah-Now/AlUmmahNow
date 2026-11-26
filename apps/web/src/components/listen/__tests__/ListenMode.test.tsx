import React, { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ListenAudioProvider, useListenAudio } from '../ListenAudioProvider';
import { ListenModeSwitch } from '@/components/VideoPagePlayer/ListenModeSwitch';

let mockLang: 'en' | 'ar' = 'en';
let mockFeatures: Record<string, boolean> = { listenMode: false };
let mockUser: { id: string } | null = { id: 'viewer-1' };

jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const en = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
    const ar = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
    return { t: mockLang === 'ar' ? ar : en, lang: mockLang, isRTL: mockLang === 'ar' };
  },
}));

jest.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({ ready: true, features: mockFeatures }),
}));

const mockFetchVideoAudio = jest.fn();
jest.mock('@/lib/listen/audio-client', () => ({
  fetchVideoAudio: (...args: unknown[]) => mockFetchVideoAudio(...args),
}));

type VhsListenerMap = Record<string, Array<() => void>>;
interface MockVhsPlayer {
  listeners: VhsListenerMap;
  src: jest.Mock;
  play: jest.Mock;
  pause: jest.Mock;
  paused: jest.Mock;
  currentTime: jest.Mock;
  duration: jest.Mock;
  playbackRate: jest.Mock;
  dispose: jest.Mock;
  isDisposed: jest.Mock;
  on: jest.Mock;
  emit: (event: string) => void;
}

let lastVhsPlayer: MockVhsPlayer | null = null;
const mockVideoJs = jest.fn((_el: Element, _opts?: Record<string, unknown>) => {
  let time = 0;
  const dur = 600;
  let rate = 1;
  let isPaused = true;
  let disposed = false;
  const listeners: VhsListenerMap = {};
  const player: MockVhsPlayer = {
    listeners,
    src: jest.fn(),
    play: jest.fn(() => {
      isPaused = false;
      return Promise.resolve();
    }),
    pause: jest.fn(() => {
      isPaused = true;
    }),
    paused: jest.fn(() => isPaused),
    currentTime: jest.fn((v?: number) => {
      if (typeof v === 'number') time = v;
      return time;
    }),
    duration: jest.fn(() => dur),
    playbackRate: jest.fn((r?: number) => {
      if (typeof r === 'number') rate = r;
      return rate;
    }),
    dispose: jest.fn(() => {
      disposed = true;
    }),
    isDisposed: jest.fn(() => disposed),
    on: jest.fn((event: string, fn: () => void) => {
      listeners[event] = [...(listeners[event] ?? []), fn];
    }),
    emit: (event: string) => {
      for (const fn of listeners[event] ?? []) fn();
    },
  };
  lastVhsPlayer = player;
  return player;
});

jest.mock('video.js', () => ({
  __esModule: true,
  default: (...args: [Element, Record<string, unknown>?]) => mockVideoJs(...args),
}));

jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function Harness({
  videoId = 'vid-42',
  onPauseVideo = jest.fn(),
  onResumeVideo = jest.fn(),
  extra,
}: {
  videoId?: string;
  onPauseVideo?: jest.Mock;
  onResumeVideo?: jest.Mock;
  extra?: React.ReactNode;
}) {
  const [listenView, setListenView] = useState(false);
  return (
    <ListenAudioProvider>
      <ListenModeSwitch
        videoId={videoId}
        title={mockLang === 'ar' ? 'سورة الكهف' : 'Surah Al-Kahf'}
        channelName={mockLang === 'ar' ? 'القارئ' : 'Reciter'}
        thumbnailUrl="https://cdn.example/thumb.jpg"
        duration={600}
        getVideoPlaybackState={() => ({ currentTime: 125, playbackRate: 1.5 })}
        pauseVideo={onPauseVideo}
        resumeVideoAt={onResumeVideo}
        isListenView={listenView}
        onListenViewChange={setListenView}
      />
      {extra}
    </ListenAudioProvider>
  );
}

function QueueHelper() {
  const listen = useListenAudio();
  return (
    <div>
      <button
        type="button"
        data-testid="enqueue-second"
        onClick={() =>
          listen.addToQueue({
            videoId: 'vid-99',
            title: 'Second Lecture',
            channelName: 'Scholar 2',
            duration: 300,
          })
        }
      >
        Enqueue second
      </button>
      <button
        type="button"
        data-testid="enqueue-third"
        onClick={() =>
          listen.addToQueue({
            videoId: 'vid-100',
            title: 'Third Lecture',
            channelName: 'Scholar 3',
            duration: 320,
          })
        }
      >
        Enqueue third
      </button>
    </div>
  );
}

describe('Web Listen mode & persistent mini bar (E14-S6)', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockFeatures = { listenMode: false };
    mockUser = { id: 'viewer-1' };
    lastVhsPlayer = null;
    mockVideoJs.mockClear();
    mockFetchVideoAudio.mockReset();
    mockFetchVideoAudio.mockImplementation(async (id: string) => ({
      videoId: id,
      format: 'hls',
      url: `https://media.alummahnow.test/pub/${id}/r1/a/orig/index.m3u8`,
      contentType: 'application/vnd.apple.mpegurl',
      trackId: 'orig',
      tracks: [{ id: 'orig', language: 'ar', isDefault: true }],
    }));
    jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    jest.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    jest.spyOn(window.HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing at all when listenMode feature switch is OFF', () => {
    render(<Harness />);
    expect(screen.queryByTestId('watch-listen-controls')).toBeNull();
    expect(screen.queryByTestId('listen-mini-bar')).toBeNull();
    expect(screen.queryByTestId('listen-audio-element')).toBeNull();
  });

  it('renders nothing at all when signed out even if listenMode is ON (E14-D3)', () => {
    mockUser = null;
    mockFeatures = { listenMode: true };
    render(<Harness />);
    expect(screen.queryByTestId('watch-listen-controls')).toBeNull();
    expect(screen.queryByTestId('listen-mini-bar')).toBeNull();
    expect(screen.queryByTestId('listen-audio-element')).toBeNull();
  });

  it('plays HLS via Video.js VHS on browsers without native HLS, preserves timestamp & speed, and disposes cleanly on close', async () => {
    mockFeatures = { listenMode: true };
    const onPauseVideo = jest.fn();
    const onResumeVideo = jest.fn();

    render(<Harness onPauseVideo={onPauseVideo} onResumeVideo={onResumeVideo} />);
    fireEvent.click(screen.getByTestId('watch-listen-toggle'));

    await waitFor(() => expect(screen.getByTestId('watch-listen-card')).toBeInTheDocument());
    await waitFor(() => expect(mockVideoJs).toHaveBeenCalledTimes(1));
    expect(onPauseVideo).toHaveBeenCalledTimes(1);
    expect(mockFetchVideoAudio).toHaveBeenCalledWith('vid-42');

    // Video.js VHS was initialized with overrideNative + HLS source
    expect(lastVhsPlayer).not.toBeNull();
    expect(lastVhsPlayer!.src).toHaveBeenCalledWith([
      {
        src: 'https://media.alummahnow.test/pub/vid-42/r1/a/orig/index.m3u8',
        type: 'application/vnd.apple.mpegurl',
      },
    ]);
    expect(lastVhsPlayer!.playbackRate).toHaveBeenCalledWith(1.5);
    expect(lastVhsPlayer!.play).toHaveBeenCalled();

    // Persistent mini bar appears with preserved 1.5× speed
    const miniBar = screen.getByTestId('listen-mini-bar');
    expect(miniBar).toBeInTheDocument();
    expect(screen.getByTestId('listen-speed-button').textContent).toContain('1.5×');

    // Sleep timer popover works
    fireEvent.click(screen.getByTestId('listen-sleep-button'));
    expect(screen.getByTestId('listen-sleep-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('listen-sleep-15'));
    expect(screen.getByTestId('listen-sleep-remaining').textContent).toBe('15:00');

    // Queue drawer opens cleanly
    fireEvent.click(screen.getByTestId('listen-queue-button'));
    expect(screen.getByTestId('listen-queue-empty')).toBeInTheDocument();

    // Returning to video restores timestamp and speed
    fireEvent.click(screen.getByTestId('watch-video-toggle'));
    expect(onResumeVideo).toHaveBeenCalledWith(125, 1.5);

    // Closing mini bar disposes the VHS player
    fireEvent.click(screen.getByTestId('listen-close-button'));
    expect(lastVhsPlayer!.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses native <audio> directly when browser natively supports HLS (Safari/WebKit)', async () => {
    mockFeatures = { listenMode: true };
    jest.spyOn(window.HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');

    render(<Harness />);
    fireEvent.click(screen.getByTestId('watch-listen-toggle'));

    await waitFor(() => expect(screen.getByTestId('watch-listen-card')).toBeInTheDocument());
    expect(mockVideoJs).not.toHaveBeenCalled();
    const audioEl = screen.getByTestId('listen-audio-element') as HTMLAudioElement;
    expect(audioEl.src).toBe('https://media.alummahnow.test/pub/vid-42/r1/a/orig/index.m3u8');
  });

  it('shows localized error and NEVER falls back to video stream when fetchVideoAudio fails', async () => {
    mockFeatures = { listenMode: true };
    mockFetchVideoAudio.mockResolvedValue(null);
    const onPauseVideo = jest.fn();

    render(<Harness onPauseVideo={onPauseVideo} />);
    fireEvent.click(screen.getByTestId('watch-listen-toggle'));

    await waitFor(() => expect(screen.getByTestId('watch-listen-error')).toBeInTheDocument());
    expect(screen.queryByTestId('watch-listen-card')).toBeNull();
    expect(screen.queryByTestId('listen-mini-bar')).toBeNull();
    expect(onPauseVideo).not.toHaveBeenCalled();
    expect(mockVideoJs).not.toHaveBeenCalled();
  });

  it('does not fetch/store signed URLs at enqueue time, resolves fresh URL on playNext and queue click, and stays safe under StrictMode', async () => {
    mockFeatures = { listenMode: true };

    render(
      <StrictMode>
        <Harness extra={<QueueHelper />} />
      </StrictMode>,
    );

    // Enqueuing must NOT call fetchVideoAudio (stores metadata only so URLs never expire in queue)
    fireEvent.click(screen.getByTestId('enqueue-second'));
    fireEvent.click(screen.getByTestId('enqueue-third'));
    expect(mockFetchVideoAudio).not.toHaveBeenCalled();

    // Start first track
    fireEvent.click(screen.getByTestId('watch-listen-toggle'));
    await waitFor(() => expect(screen.getByTestId('listen-track-title').textContent).toBe('Surah Al-Kahf'));
    await waitFor(() => expect(lastVhsPlayer).not.toBeNull());
    expect(mockFetchVideoAudio).toHaveBeenCalledTimes(1);
    expect(mockFetchVideoAudio).toHaveBeenLastCalledWith('vid-42');

    // Track ends -> playNext resolves vid-99 fresh exactly ONCE (never skips vid-99 to vid-100)
    await act(async () => {
      lastVhsPlayer!.emit('ended');
    });
    await waitFor(() => expect(screen.getByTestId('listen-track-title').textContent).toBe('Second Lecture'));
    expect(mockFetchVideoAudio).toHaveBeenCalledTimes(2);
    expect(mockFetchVideoAudio).toHaveBeenLastCalledWith('vid-99');

    // Clicking remaining queued item (vid-100) resolves fresh URL at click time
    fireEvent.click(screen.getByTestId('listen-queue-button'));
    const thirdBtn = screen.getByTestId('listen-queue-item-vid-100').querySelector('button')!;
    fireEvent.click(thirdBtn);
    await waitFor(() => expect(screen.getByTestId('listen-track-title').textContent).toBe('Third Lecture'));
    expect(mockFetchVideoAudio).toHaveBeenCalledTimes(3);
    expect(mockFetchVideoAudio).toHaveBeenLastCalledWith('vid-100');
  });

  it('binds Media Session action handlers once without rebinding on timeupdate ticks', async () => {
    mockFeatures = { listenMode: true };
    const setActionHandler = jest.fn();
    const setPositionState = jest.fn();
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        playbackState: 'none',
        setActionHandler,
        setPositionState,
      },
    });

    render(<Harness />);
    fireEvent.click(screen.getByTestId('watch-listen-toggle'));
    await waitFor(() => expect(screen.getByTestId('listen-mini-bar')).toBeInTheDocument());
    await waitFor(() => expect(lastVhsPlayer).not.toBeNull());
    await waitFor(() =>
      expect(setActionHandler.mock.calls.some((call) => call[0] === 'play' && typeof call[1] === 'function')).toBe(
        true,
      ),
    );

    setActionHandler.mockClear();

    // Emit multiple timeupdate ticks: position state updates, action handlers are NOT rebound
    act(() => {
      lastVhsPlayer!.currentTime(130);
      lastVhsPlayer!.emit('timeupdate');
      lastVhsPlayer!.currentTime(131);
      lastVhsPlayer!.emit('timeupdate');
    });
    expect(setActionHandler).not.toHaveBeenCalled();
    expect(setPositionState).toHaveBeenCalled();
  });

  it('uses Arabic copy with «مرئي» and Eastern Arabic digits (٠–٩) in ar locale', async () => {
    mockLang = 'ar';
    mockFeatures = { listenMode: true };
    render(<Harness />);

    fireEvent.click(screen.getByTestId('watch-listen-toggle'));
    await waitFor(() => expect(screen.getByTestId('watch-listen-card')).toBeInTheDocument());

    const card = screen.getByTestId('watch-listen-card');
    expect(card.textContent).toContain('مشاهدة المرئي');
    expect(card.textContent).not.toContain('فيديو');

    const speedBtn = screen.getByTestId('listen-speed-button');
    expect(speedBtn.textContent).toContain('١.٥×');

    fireEvent.click(screen.getByTestId('listen-sleep-button'));
    expect(screen.getByTestId('listen-sleep-15').textContent).toContain('١٥');
    expect(screen.getByTestId('listen-sleep-30').textContent).toContain('٣٠');
  });
});
