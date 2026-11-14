/**
 * Every web player plays the API's sources in the API's order (docs/media-delivery/PROVIDERS.md):
 * no client-side choice. When a source fails it moves to the next at once and reports the failure
 * (GET /playback?exclude=<failed so far>&reason=<class>); when the list is used up, that answer's
 * sources come next. 2026-11-12: the RTL player once ignored delivery entirely.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import type { PlayerOptions } from '../interface';

type Handler = (...args: unknown[]) => void;
class FakePlayer {
  handlers = new Map<string, Set<Handler>>();
  srcs: { src: string; type: string }[] = [];
  err: { code?: number; status?: number } | null = null;
  on(e: string, fn: Handler) { if (!this.handlers.has(e)) this.handlers.set(e, new Set()); this.handlers.get(e)!.add(fn); }
  off(e: string, fn: Handler) { this.handlers.get(e)?.delete(fn); }
  one(e: string, fn: Handler) { const w: Handler = (...a) => { this.off(e, w); fn(...a); }; this.on(e, w); }
  emit(e: string) { for (const fn of [...(this.handlers.get(e) ?? [])]) fn(); }
  error(v?: null) { if (v === null) { this.err = null; return null; } return this.err; }
  src(s: { src: string; type: string }) { this.srcs.push(s); }
  currentTime(t?: number) { return t ?? 12; }
  play() { return Promise.resolve(); }
  paused() { return false; }
  isDisposed() { return false; }
}

const seen: { sources: { src: string }[]; poster?: string }[] = [];
let player: FakePlayer;
jest.mock('@/components/VideoPagePlayer/VideoPlayerWithChapters', () => ({
  VideoPlayerWithChapters: (props: { sources: { src: string }[]; poster?: string; onPlayerReady?: (p: unknown) => void }) => {
    seen.push({ sources: props.sources, poster: props.poster });
    const ReactActual = jest.requireActual('react') as typeof React;
    ReactActual.useEffect(() => { props.onPlayerReady?.(player); }, []);
    return null;
  },
}));
jest.mock('@/components/VideoPagePlayer/VideoDetails', () => ({ VideoDetails: () => null }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS, lang: 'ar', locale: 'ar', dir: 'rtl', isRTL: true }),
}));
const fetchFallbackPlayback = jest.fn();
jest.mock('@/lib/api/videos', () => ({ fetchFallbackPlayback: (...a: unknown[]) => fetchFallbackPlayback(...a) }));
jest.mock('@/lib/video/qoe', () => {
  const actual = jest.requireActual('@/lib/video/qoe');
  return { ...actual, sendQoeBeacon: jest.fn() };
});

import VideoPlayer from '../index';
import VideoPlayerRTL from '../rtl/index';

const BUNNY = 'https://vz-215a1ffd-a5a.b-cdn.net/bcdn_token=t&expires=1&token_path=%2Fv%2F/v/playlist.m3u8';
const R2 = 'https://media.alummahnow.net/pub/37bcecd3-2449-4c8d-b4f8-f7af7367d95c/e29db4ad6918a943/master.m3u8';
const R2_THUMB = 'https://media.alummahnow.net/pub/37bcecd3-2449-4c8d-b4f8-f7af7367d95c/e29db4ad6918a943/thumb.jpg';

const ID = '37bcecd3-2449-4c8d-b4f8-f7af7367d95c';
const HLS = 'application/x-mpegURL' as const;

function options(playUrl: string, poster: string | undefined, source?: 'bunny' | 'r2', sources?: { provider: 'bunny' | 'r2'; src: string }[]): PlayerOptions {
  return {
    id: ID, title: 'وقفة', channel: 'c', channelName: 'c', channelAvatar: '', description: '', views: '0',
    url: '', playUrl, poster, autoplay: false, type: 'video/mp4', dateCreated: new Date(0), ...(source ? { delivery: { source } } : {}),
    ...(sources ? { sources: sources.map((x) => ({ ...x, type: HLS })) } : {}),
  } as PlayerOptions;
}

describe.each([
  ['LTR player', VideoPlayer],
  ['RTL (Arabic) player', VideoPlayerRTL],
])('%s', (_name, Player) => {
  beforeEach(() => {
    seen.length = 0;
    player = new FakePlayer();
    fetchFallbackPlayback.mockReset();
  });

  it('plays exactly the playUrl and thumbnail it was given (R2 chosen by the API)', () => {
    render(<Player options={options(R2, R2_THUMB, 'r2')} />);
    expect(seen.at(-1)?.sources).toEqual([{ src: R2, type: 'application/x-mpegURL' }]);
    expect(seen.at(-1)?.poster).toBe(R2_THUMB);
  });

  it('a lone source that fails is reported once; with nothing left it stays where it is', async () => {
    fetchFallbackPlayback.mockResolvedValue({ id: ID, delivery: { source: 'bunny' }, sources: [] });
    render(<Player options={options(BUNNY, undefined, 'bunny')} />);
    expect(seen.at(-1)?.sources).toEqual([{ src: BUNNY, type: HLS }]);
    player.err = { code: 2, status: 403 };
    await act(async () => { player.emit('error'); player.emit('error'); });
    expect(fetchFallbackPlayback).toHaveBeenCalledTimes(1);
    expect(fetchFallbackPlayback).toHaveBeenCalledWith(ID, 'manifest_4xx', false, ['bunny']);
    expect(player.srcs).toEqual([]);
  });

  it('an older response (playUrl only): an R2 error asks the API once and plays the Bunny URL it returns', async () => {
    fetchFallbackPlayback.mockResolvedValue({ playUrl: BUNNY, delivery: { source: 'bunny' } });
    render(<Player options={options(R2, R2_THUMB, 'r2')} />);
    player.err = { code: 2, status: 403 };
    await act(async () => { player.emit('error'); player.emit('error'); });
    expect(fetchFallbackPlayback).toHaveBeenCalledTimes(1);
    expect(fetchFallbackPlayback).toHaveBeenCalledWith(ID, 'manifest_4xx', false, ['r2']);
    expect(player.srcs).toEqual([{ src: BUNNY, type: HLS }]);
  });

  it('with sources it moves to the next at once, reports each failure, and asks for more only at the end', async () => {
    let reply: (v: unknown) => void = () => undefined;
    fetchFallbackPlayback.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
    render(<Player options={options(R2, R2_THUMB, 'r2', [{ provider: 'r2', src: R2 }, { provider: 'bunny', src: BUNNY }])} />);
    expect(seen.at(-1)?.sources).toEqual([{ src: R2, type: HLS }]);
    player.err = { code: 4 };
    act(() => player.emit('error'));
    // Bunny plays before the report is answered
    expect(player.srcs).toEqual([{ src: BUNNY, type: HLS }]);
    expect(fetchFallbackPlayback).toHaveBeenLastCalledWith(ID, 'unsupported', false, ['r2']);
    await act(async () => { reply({ playUrl: BUNNY, delivery: { source: 'bunny' }, sources: [{ provider: 'bunny', src: BUNNY, type: HLS }] }); });
    expect(player.srcs).toHaveLength(1);
    // Bunny fails too: both are reported, and the API has nothing new
    player.err = { code: 2, status: 503 };
    act(() => player.emit('error'));
    expect(fetchFallbackPlayback).toHaveBeenLastCalledWith(ID, 'manifest_5xx', false, ['r2', 'bunny']);
    await act(async () => { reply({ id: ID, delivery: { source: 'bunny' }, sources: [] }); });
    expect(player.srcs).toHaveLength(1);
    act(() => player.emit('error'));
    expect(fetchFallbackPlayback).toHaveBeenCalledTimes(2);
  });

  it('follows the API order whatever it is: Bunny first, R2 next', async () => {
    fetchFallbackPlayback.mockResolvedValue(null);
    render(<Player options={options(BUNNY, undefined, 'bunny', [{ provider: 'bunny', src: BUNNY }, { provider: 'r2', src: R2 }])} />);
    expect(seen.at(-1)?.sources).toEqual([{ src: BUNNY, type: HLS }]);
    player.err = { code: 2, status: 0 };
    await act(async () => { player.emit('error'); });
    expect(player.srcs).toEqual([{ src: R2, type: HLS }]);
    expect(fetchFallbackPlayback).toHaveBeenCalledWith(ID, 'cors', false, ['bunny']);
  });

  it('a source from the API that already failed is never played again', async () => {
    fetchFallbackPlayback.mockResolvedValue({ playUrl: R2, delivery: { source: 'r2' }, sources: [{ provider: 'r2', src: R2, type: HLS }] });
    render(<Player options={options(R2, R2_THUMB, 'r2')} />);
    player.err = { code: 2 };
    await act(async () => { player.emit('error'); });
    expect(player.srcs).toEqual([]);
  });

  it('falls back with stall_timeout when R2 stalls too long', async () => {
    jest.useFakeTimers();
    try {
      fetchFallbackPlayback.mockResolvedValue({ playUrl: BUNNY, delivery: { source: 'bunny' } });
      render(<Player options={options(R2, R2_THUMB, 'r2')} />);
      act(() => player.emit('waiting'));
      await act(async () => { jest.advanceTimersByTime(15_000); });
      expect(fetchFallbackPlayback).toHaveBeenCalledWith(expect.any(String), 'stall_timeout', false, ['r2']);
    } finally {
      jest.useRealTimers();
    }
  });
});
