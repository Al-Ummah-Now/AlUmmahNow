/**
 * @jest-environment jsdom
 */
import { setupMobileTouchControls, isVideoSurface } from '../mobile-touch';
import type { ExtendedPlayer } from '../videojs';

jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() } }));

function makePlayer(fullscreen = false) {
  const el = document.createElement('div');
  el.innerHTML = '<video class="vjs-tech"></video><div class="vjs-control-bar"><button class="vjs-play-control vjs-control"><span>Play</span></button></div>';
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 170, right: 300, bottom: 170, x: 0, y: 0, toJSON: () => ({}) });
  document.body.appendChild(el);
  const state = { paused: false, time: 30, volume: 0.5, rate: 1 };
  const player = {
    el: () => el,
    paused: () => state.paused,
    play: jest.fn(() => { state.paused = false; }),
    pause: jest.fn(() => { state.paused = true; }),
    currentTime: jest.fn((t?: number) => { if (t !== undefined) state.time = t; return state.time; }),
    duration: () => 90,
    volume: jest.fn((v?: number) => { if (v !== undefined) state.volume = v; return state.volume; }),
    playbackRate: jest.fn((r?: number) => { if (r !== undefined) state.rate = r; return state.rate; }),
    isFullscreen: () => fullscreen,
  };
  return { el, player, state };
}

function touch(target: Element, type: string, x: number, y: number) {
  const t = { clientX: x, clientY: y, target } as unknown as Touch;
  const ev = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
  Object.defineProperty(ev, 'changedTouches', { value: [t] });
  target.dispatchEvent(ev);
  return ev;
}

function tap(target: Element, x: number, y: number) {
  touch(target, 'touchstart', x, y);
  return touch(target, 'touchend', x, y);
}

describe('mobile touch gestures', () => {
  beforeEach(() => { jest.useFakeTimers(); document.body.innerHTML = ''; });
  afterEach(() => jest.useRealTimers());

  it('treats controls as controls, the video as the surface', () => {
    const { el } = makePlayer();
    expect(isVideoSurface(el.querySelector('video'))).toBe(true);
    expect(isVideoSurface(el.querySelector('.vjs-play-control span'))).toBe(false);
  });

  it('two quick taps on a bar button are not a double tap', () => {
    const { el, player } = makePlayer();
    setupMobileTouchControls(player as unknown as ExtendedPlayer);
    const btn = el.querySelector('.vjs-play-control')!;
    tap(btn, 20, 150);
    jest.advanceTimersByTime(100);
    tap(btn, 20, 150);
    expect(player.currentTime).not.toHaveBeenCalledWith(20);
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('a slow press on a bar button never changes the speed', () => {
    const { el, player } = makePlayer();
    setupMobileTouchControls(player as unknown as ExtendedPlayer);
    const btn = el.querySelector('.vjs-play-control')!;
    touch(btn, 'touchstart', 20, 150);
    jest.advanceTimersByTime(800);
    touch(btn, 'touchend', 20, 150);
    expect(player.playbackRate).not.toHaveBeenCalledWith(1.25);
  });

  it('a double tap on the video still seeks', () => {
    const { el, player } = makePlayer();
    setupMobileTouchControls(player as unknown as ExtendedPlayer);
    const v = el.querySelector('video')!;
    tap(v, 20, 60);
    jest.advanceTimersByTime(100);
    tap(v, 22, 60);
    expect(player.currentTime).toHaveBeenCalledWith(20);
  });

  it('a long press on the video changes speed once and its release is swallowed', () => {
    const { el, player } = makePlayer();
    setupMobileTouchControls(player as unknown as ExtendedPlayer);
    const v = el.querySelector('video')!;
    touch(v, 'touchstart', 150, 60);
    jest.advanceTimersByTime(600);
    const end = touch(v, 'touchend', 150, 60);
    expect(player.playbackRate).toHaveBeenCalledWith(1.25);
    expect(end.defaultPrevented).toBe(true);
  });

  it('inline, a vertical drag on the video scrolls the page instead of changing the volume', () => {
    const { el, player } = makePlayer(false);
    setupMobileTouchControls(player as unknown as ExtendedPlayer);
    const v = el.querySelector('video')!;
    touch(v, 'touchstart', 150, 120);
    const move = touch(v, 'touchmove', 150, 60);
    expect(move.defaultPrevented).toBe(false);
    expect(player.volume).not.toHaveBeenCalledWith(expect.any(Number));
  });

  it('in fullscreen, a vertical drag changes the volume', () => {
    const { el, player } = makePlayer(true);
    setupMobileTouchControls(player as unknown as ExtendedPlayer);
    const v = el.querySelector('video')!;
    touch(v, 'touchstart', 150, 120);
    const move = touch(v, 'touchmove', 150, 60);
    expect(move.defaultPrevented).toBe(true);
    expect(player.volume).toHaveBeenLastCalledWith(expect.any(Number));
  });
});
