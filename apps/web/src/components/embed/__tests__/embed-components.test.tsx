/**
 * Embed frames and the watch page share dialog (docs/embeds/README.md).
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import EmbedPlayer from '../EmbedPlayer';
import UnavailableFrame from '../UnavailableFrame';
import ShareDialog from '@/components/video/ShareDialog';
import { parseEmbedParams } from '@/lib/embed/params';
import { getPlayerUi } from '@/lib/video/player-ui';
import { isAutoMuted } from '@/lib/video/volume-control';
import type { EmbedVideo } from '@/lib/embed/content';

jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

// The real player needs Video.js + MSE; record the props the frame passes instead
// A test may hand the frame a fake Video.js player (globalThis.__fakePlayer) as if it became ready
jest.mock('@/components/VideoPagePlayer/VideoPlayerWithChapters', () => ({
  VideoPlayerWithChapters: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react') as typeof import('react');
    useEffect(() => {
      const fake = (globalThis as { __fakePlayer?: unknown }).__fakePlayer;
      if (fake) (props.onPlayerReady as (p: unknown) => void)(fake);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
    <div
      data-testid="mock-player"
      data-video={String(props.videoId)}
      data-start={String(props.startTime)}
      data-muted={String(props.muted)}
      data-autoplay={String(props.autoplayIntent ?? props.autoplay)}
      data-lang={String(props.lang)}
      data-context={JSON.stringify(props.analyticsContext)}
      data-websocket={String(props.enableWebSocket)}
    />
    );
  },
}));

const realFetch = globalThis.fetch;
/** jsdom has no fetch: a no-op one for tests whose player flushes beacons */
function stubFetch() {
  globalThis.fetch = jest.fn(() => Promise.resolve({ ok: true })) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * A minimal Video.js player: play() resolves, or rejects with `refuse` (e.g. NotAllowedError) while
 * unmuted; `aborts` rejects that many plays with AbortError first, muted or not. Its source has
 * metadata unless `state` says otherwise.
 */
function fakePlayer(refuse?: string, { aborts = 0, state = { readyState: 1, paused: false } } = {}) {
  const handlers: Record<string, Array<() => void>> = {};
  const once: Record<string, Array<() => void>> = {};
  let abortsLeft = aborts;
  let muted = false;
  let volume = 1;
  const calls: Array<{ muted: boolean }> = [];
  const player = {
    calls,
    on: (e: string, fn: () => void) => { (handlers[e] ??= []).push(fn); },
    one: (e: string, fn: () => void) => { (once[e] ??= []).push(fn); },
    off: (e: string, fn: () => void) => { handlers[e] = (handlers[e] ?? []).filter((f) => f !== fn); },
    fire: (e: string) => {
      const due = once[e] ?? [];
      once[e] = [];
      [...(handlers[e] ?? []), ...due].forEach((fn) => fn());
    },
    state,
    readyState: () => state.readyState,
    muted: (v?: boolean) => {
      if (v === undefined) return muted;
      muted = v;
      (handlers.volumechange ?? []).forEach((fn) => fn());
      return undefined;
    },
    volume: (v?: number) => (v === undefined ? volume : ((volume = v), undefined)),
    play: () => {
      calls.push({ muted });
      if (abortsLeft > 0) {
        abortsLeft -= 1;
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }
      if (refuse && !muted) {
        const err = new Error('refused');
        err.name = refuse;
        return Promise.reject(err);
      }
      return Promise.resolve();
    },
    paused: () => state.paused,
    pause: () => {
      state.paused = true;
      player.fire('pause');
    },
    currentTime: () => 0,
    duration: () => 75,
    loop: () => undefined,
    error: () => null,
    isDisposed: () => false,
  };
  return player;
}
afterEach(() => {
  delete (globalThis as { __fakePlayer?: unknown }).__fakePlayer;
});

/** Lets a gesture start's 1 ms timer (lib/video/start-playback.ts) and its play() promises run. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

const video = (id: string, extra: Partial<EmbedVideo> = {}): EmbedVideo => ({
  id,
  title: `Title ${id}`,
  titleLocalized: { en: `Title ${id}`, ar: `عنوان ${id}` },
  playUrl: `https://vz.example/${id}/playlist.m3u8`,
  poster: `https://vz.example/${id}/thumbnail.jpg`,
  duration: 75,
  channelName: 'QA Channel',
  ...extra,
});

const postMessage = jest.fn();
const realParent = window.parent;

function embedInto(referrer: string) {
  Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage } });
  Object.defineProperty(document, 'referrer', { configurable: true, value: referrer });
}

afterEach(() => {
  postMessage.mockReset();
  Object.defineProperty(window, 'parent', { configurable: true, value: realParent });
  Object.defineProperty(document, 'referrer', { configurable: true, value: '' });
});

describe('EmbedPlayer', () => {
  it('drops a poster that fails to load, so the facade shows the backdrop, not a broken-image frame', () => {
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({})} />);
    const poster = screen.getByTestId('embed-poster');
    expect(poster).toHaveAttribute('src', 'https://vz.example/v1/thumbnail.jpg');
    fireEvent.error(poster);
    expect(screen.queryByTestId('embed-poster')).toBeNull();
    // The facade itself stays: the title and the play button are still there
    expect(screen.getByTestId('embed-facade')).toBeInTheDocument();
  });

  it('shows a facade first and loads the player on press, at the start position', () => {
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ start: '30' })} />);
    expect(screen.queryByTestId('mock-player')).toBeNull();
    expect(screen.getByTestId('embed-title')).toHaveTextContent('Title v1');
    expect(screen.getByTestId('embed-watch-link')).toHaveAttribute('href', '/en/video/v1?t=30');
    expect(screen.getByTestId('embed-watch-link')).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByTestId('embed-facade'));
    const player = screen.getByTestId('mock-player');
    expect(player).toHaveAttribute('data-start', '30');
    expect(player).toHaveAttribute('data-autoplay', 'true');
    expect(player).toHaveAttribute('data-muted', 'false');
    expect(player).toHaveAttribute('data-websocket', 'false');
  });

  it('autoplay=1 loads the player at once, muted, tagged as an embed view', () => {
    embedInto('https://www.alummahnow.net/articles/eid');
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ autoplay: '1' })} />);
    const player = screen.getByTestId('mock-player');
    expect(player).toHaveAttribute('data-muted', 'true');
    expect(JSON.parse(player.getAttribute('data-context')!)).toEqual({ source: 'embed', embedOrigin: 'https://www.alummahnow.net' });
  });

  it('autoplay=1&gesture=1 (a click on the host page) plays with sound, no unmute control', async () => {
    const player = fakePlayer();
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ autoplay: '1', gesture: '1' })} />);
    const el = screen.getByTestId('mock-player');
    // The frame starts it itself (Video.js autoplay off), unmuted
    expect(el).toHaveAttribute('data-autoplay', 'false');
    expect(el).toHaveAttribute('data-muted', 'false');
    await settle();
    expect(player.calls).toEqual([{ muted: false }]);
    expect(player.muted()).toBe(false);
    expect(screen.queryByTestId('embed-unmute')).toBeNull();
  });

  it('gesture start refused by the browser: plays muted and shows "Tap to unmute", which unmutes', async () => {
    const player = fakePlayer('NotAllowedError');
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ autoplay: '1', gesture: '1', lang: 'ar' })} />);
    await settle();
    expect(player.calls).toEqual([{ muted: false }, { muted: true }]);
    const unmute = await screen.findByTestId('embed-unmute');
    expect(unmute).toHaveTextContent('اضغط لتشغيل الصوت');
    fireEvent.click(unmute);
    expect(player.muted()).toBe(false);
    expect(screen.queryByTestId('embed-unmute')).toBeNull();
  });

  const gesture = () => render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ autoplay: '1', gesture: '1' })} />);

  it('gesture start waits for the source to be attached: an earlier play() makes Video.js attach it twice in Safari', async () => {
    const player = fakePlayer(undefined, { state: { readyState: 0, paused: false } });
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    await settle();
    expect(player.calls).toEqual([]);
    await act(async () => player.fire('loadstart'));
    await settle();
    expect(player.calls).toEqual([{ muted: false }]);
    // once: a later source's loadstart starts nothing
    await act(async () => player.fire('loadstart'));
    await settle();
    expect(player.calls).toHaveLength(1);
  });

  it('gesture start aborted by a source change plays at loadedmetadata (WebKit never reaches canplay while paused)', async () => {
    const player = fakePlayer(undefined, { aborts: 1, state: { readyState: 0, paused: false } });
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    await act(async () => player.fire('loadstart'));
    await settle();
    expect(player.calls).toHaveLength(1);
    await act(async () => player.fire('loadedmetadata'));
    expect(player.calls).toEqual([{ muted: false }, { muted: false }]);
    expect(screen.queryByTestId('embed-unmute')).toBeNull();
  });

  it('sound refused and then the muted play aborted: still plays muted once the source is there', async () => {
    const player = fakePlayer('NotAllowedError', { state: { readyState: 0, paused: false } });
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    const play = player.play;
    let abort = true;
    player.play = () => {
      if (!player.muted() || !abort) return play();
      abort = false;
      void play();
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    gesture();
    await act(async () => player.fire('loadstart'));
    await settle();
    expect(player.calls).toEqual([{ muted: false }, { muted: true }]);
    await act(async () => player.fire('loadedmetadata'));
    expect(player.calls).toEqual([{ muted: false }, { muted: true }, { muted: true }]);
    expect(screen.getByTestId('embed-unmute')).toBeInTheDocument();
  });

  it('gesture start stops trying after its retries', async () => {
    const player = fakePlayer('AbortError', { state: { readyState: 0, paused: false } });
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    await act(async () => player.fire('loadstart'));
    await settle();
    for (let i = 0; i < 5; i += 1) await act(async () => player.fire('loadedmetadata'));
    expect(player.calls).toHaveLength(3);
  });

  it('gesture start that fails with another error is not retried (the delivery fallback plays its own source)', async () => {
    const player = fakePlayer('NotSupportedError', { state: { readyState: 0, paused: false } });
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    await act(async () => player.fire('loadstart'));
    await settle();
    await act(async () => player.fire('loadedmetadata'));
    expect(player.calls).toHaveLength(1);
  });

  it.each([0, 1])('a pause during the pending play (AbortError too) is never overridden (readyState %i)', async (readyState) => {
    const player = fakePlayer('AbortError', { state: { readyState: 0, paused: false } });
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    const play = player.play;
    player.play = () => {
      const result = play();
      player.state.readyState = readyState;
      player.pause(); // the pause event comes first, then the rejection
      return result;
    };
    await act(async () => player.fire('loadstart'));
    await settle();
    expect(player.calls).toHaveLength(1);
    await act(async () => player.fire('loadedmetadata'));
    await act(async () => player.fire('canplay'));
    expect(player.calls).toHaveLength(1);
  });

  it("the host page's pause command before the source is attached cancels the start", async () => {
    embedInto('https://host.example/page');
    const player = fakePlayer(undefined, { state: { readyState: 0, paused: true } });
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    act(() => {
      const event = new MessageEvent('message', { data: { type: 'aun:v1:command', command: 'pause' }, origin: 'https://host.example' });
      Object.defineProperty(event, 'source', { value: window.parent });
      window.dispatchEvent(event);
    });
    await act(async () => player.fire('loadstart'));
    await settle();
    await act(async () => player.fire('loadedmetadata'));
    expect(player.calls).toEqual([]);
  });

  it('a mute remembered from another video does not silence a gesture start', async () => {
    const player = fakePlayer(undefined, { state: { readyState: 0, paused: false } });
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    player.muted(true); // the remembered volume, applied after ready
    await act(async () => player.fire('loadstart'));
    await settle();
    expect(player.calls).toEqual([{ muted: false }]);
    expect(player.muted()).toBe(false);
    expect(screen.queryByTestId('embed-unmute')).toBeNull();
  });

  it('a remembered volume of 0 offers "Tap to unmute", which brings the sound back', async () => {
    const player = fakePlayer();
    player.volume(0);
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    fireEvent.click(await screen.findByTestId('embed-unmute'));
    expect(player.volume()).toBe(1);
    expect(screen.queryByTestId('embed-unmute')).toBeNull();
  });

  it("the browser's own mute is never remembered as the viewer's", async () => {
    const player = fakePlayer('NotAllowedError');
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    gesture();
    await settle();
    expect(player.muted()).toBe(true);
    expect(isAutoMuted(player)).toBe(true);
  });

  it('plain autoplay=1 stays muted (third-party autoplay) and offers "Tap to unmute" once playing', async () => {
    const player = fakePlayer();
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ autoplay: '1' })} />);
    expect(screen.getByTestId('mock-player')).toHaveAttribute('data-autoplay', 'true');
    player.muted(true); // CustomVideoPlayer applies the muted prop
    await act(async () => player.fire('playing'));
    expect(screen.getByTestId('embed-unmute')).toHaveTextContent('Tap to unmute');
    expect(player.calls).toEqual([]);
  });

  it('hides "Tap to unmute" while the end screen is up, so it never covers Replay; it returns on replay (2026-11-13 stage)', async () => {
    const player = fakePlayer();
    (globalThis as { __fakePlayer?: unknown }).__fakePlayer = player;
    // 'ended' (and the unmount after the test) flush the QoE beacon; restored in afterEach
    stubFetch();
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ autoplay: '1' })} />);
    player.muted(true);
    await act(async () => player.fire('playing'));
    expect(screen.getByTestId('embed-unmute')).toBeInTheDocument();
    await act(async () => player.fire('ended'));
    expect(screen.queryByTestId('embed-unmute')).toBeNull();
    await act(async () => player.fire('play'));
    expect(screen.getByTestId('embed-unmute')).toBeInTheDocument();
  });

  it('renders Arabic right to left with the Arabic title', () => {
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({ lang: 'ar' })} />);
    const main = screen.getByTestId('embed-player');
    expect(main).toHaveAttribute('dir', 'rtl');
    expect(main).toHaveAttribute('lang', 'ar');
    expect(screen.getByTestId('embed-title')).toHaveTextContent('عنوان v1');
    expect(screen.getByTestId('embed-watch-link')).toHaveTextContent('شاهد على الأمة الآن');
  });

  it('posts ready to the embedding origin only', () => {
    embedInto('https://host.example/page?x=1');
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({})} />);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'aun:v1:event', event: 'ready', videoId: 'v1', duration: 75 }),
      'https://host.example',
    );
  });

  it('answers commands only from the partner origin', () => {
    embedInto('https://host.example/page');
    render(<EmbedPlayer videos={[video('v1')]} params={parseEmbedParams({})} />);
    postMessage.mockClear();
    const send = (origin: string) => act(() => {
      const event = new MessageEvent('message', { data: { type: 'aun:v1:command', command: 'play' }, origin });
      Object.defineProperty(event, 'source', { value: window.parent });
      window.dispatchEvent(event);
    });
    send('https://evil.example');
    expect(screen.queryByTestId('mock-player')).toBeNull();
    send('https://host.example');
    expect(screen.getByTestId('mock-player')).toBeInTheDocument();
  });

  it('plays a playlist from the requested index and lists its videos', () => {
    render(
      <EmbedPlayer
        videos={[video('a'), video('b'), video('c')]}
        params={parseEmbedParams({ index: '1' })}
        playlist={{ id: 'p1', title: 'Series' }}
      />,
    );
    expect(screen.getByTestId('embed-player')).toHaveAttribute('data-video-id', 'b');
    fireEvent.click(screen.getByTestId('embed-playlist-toggle'));
    const list = screen.getByTestId('embed-playlist');
    expect(list).toHaveTextContent('Series');
    fireEvent.click(screen.getByText('Title c'));
    expect(screen.getByTestId('mock-player')).toHaveAttribute('data-video', 'c');
  });

  it('the end screen offers the next item in order, and stops after the last (PLAYLIST-PLAYBACK D9)', () => {
    render(
      <EmbedPlayer
        videos={[video('a', { listIndex: 0 }), video('b', { listIndex: 3 }), video('c', { listIndex: 4 })]}
        params={parseEmbedParams({ index: '1' })}
        playlist={{ id: 'p1', title: 'Series' }}
      />,
    );
    fireEvent.click(screen.getByTestId('embed-facade'));
    const upNext = getPlayerUi().upNext;
    expect(upNext?.title).toBe('Title c');
    expect(upNext?.badge).toBe('3 / 3');
    // "Watch on" continues the list on the watch page at this item's stored index
    expect(screen.getByTestId('embed-watch-link').getAttribute('href')).toBe('/en/video/b?list=p1&index=3');
    act(() => upNext!.go());
    expect(screen.getByTestId('mock-player')).toHaveAttribute('data-video', 'c');
    expect(getPlayerUi().upNext).toBeNull();
  });
});

describe('UnavailableFrame', () => {
  it('shows the localized unavailable frame and reports it to the parent', () => {
    embedInto('https://host.example/');
    render(<UnavailableFrame lang="ar" origin={null} contentId="private1" />);
    const frame = screen.getByTestId('embed-unavailable');
    expect(frame).toHaveAttribute('dir', 'rtl');
    expect(frame).toHaveTextContent('هذا المرئي غير متاح');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'error', videoId: 'private1', error: { code: 'unavailable' } }),
      'https://host.example',
    );
  });
});

describe('ShareDialog', () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  beforeAll(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });
  beforeEach(() => writeText.mockClear());

  const open = (time = 0) => {
    render(<ShareDialog videoId="v1" title="Tafsir" lang="en" getCurrentTime={() => time} />);
    fireEvent.click(screen.getByTestId('share-button'));
  };

  it('copies the watch link', async () => {
    open();
    const link = `${window.location.origin}/en/video/v1`;
    expect(screen.getByTestId('share-link')).toHaveValue(link);
    await act(async () => { fireEvent.click(screen.getByTestId('share-copy-link')); });
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByTestId('share-copy-link')).toHaveTextContent('Copied');
  });

  it('copies the link at the current time when asked', async () => {
    open(754.4);
    fireEvent.click(screen.getByTestId('share-at-time'));
    expect(screen.getByText('Start at 12:34')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTestId('share-copy-link')); });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/en/video/v1?t=754`);
  });

  it('copies the 560×315 embed snippet by default and the responsive one on request', async () => {
    open();
    const src = `${window.location.origin}/embed/v/v1`;
    await act(async () => { fireEvent.click(screen.getByTestId('share-copy-embed')); });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(`<iframe src="${src}" width="560" height="315"`));
    fireEvent.click(screen.getByTestId('share-size-responsive'));
    await act(async () => { fireEvent.click(screen.getByTestId('share-copy-embed')); });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('aspect-ratio:16/9'));
  });
});
