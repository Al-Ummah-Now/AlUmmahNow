/**
 * The player shows QF's credit link while a cue with Quran text from QF is on screen, and the caption
 * itself no longer carries the credit line (QF 2026-11-23).
 */
import { act, renderHook } from '@testing-library/react';
import { CAPTION_CREDIT_CLASS, placeCredit, useQuranCaptionCredit } from '../useQuranCaptionCredit';

function fakeTrack(cues: Array<{ text: string }>) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    kind: 'subtitles',
    mode: 'showing',
    language: 'ar',
    cues,
    activeCues: [] as Array<{ text: string }>,
    addEventListener: (e: string, f: () => void) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e)!.add(f); },
    removeEventListener: (e: string, f: () => void) => listeners.get(e)?.delete(f),
    fire: (e: string) => listeners.get(e)?.forEach((f) => f()),
  };
}

function fakePlayer(track: ReturnType<typeof fakeTrack>) {
  const classes = new Set<string>();
  const updateDisplay = jest.fn();
  const list = Object.assign([track], { addEventListener: jest.fn(), removeEventListener: jest.fn() });
  return {
    classes,
    updateDisplay,
    player: {
      textTracks: () => list,
      getChild: (n: string) => (n === 'textTrackDisplay' ? { updateDisplay } : undefined),
      addClass: (c: string) => classes.add(c),
      removeClass: (c: string) => classes.delete(c),
    },
  };
}

describe('placeCredit', () => {
  it('puts the credit under the cue at its end side, 70% of its text size, in its colours', () => {
    const player = document.createElement('div');
    player.innerHTML = '<div class="vjs-text-track-display"><div class="vjs-text-track-cue"><div style="font-size:30px;color:rgb(255, 255, 255);background-color:rgba(0, 0, 0, 0.8)">cue</div></div></div>';
    const cue = player.querySelector<HTMLElement>('.vjs-text-track-cue > div')!;
    player.getBoundingClientRect = () => ({ left: 0, right: 1000, top: 0, bottom: 562, width: 1000, height: 562 }) as DOMRect;
    cue.getBoundingClientRect = () => ({ left: 300, right: 700, top: 440, bottom: 474, width: 400, height: 34 }) as DOMRect;
    placeCredit(player, 'ltr');
    expect(player.style.getPropertyValue('--fanous-credit-end')).toBe('300px');
    expect(player.style.getPropertyValue('--fanous-credit-size')).toBe('21px');
    expect(player.style.getPropertyValue('--fanous-credit-color')).toBe('rgb(255, 255, 255)');
    expect(player.style.getPropertyValue('--fanous-credit-bg')).toBe('rgba(0, 0, 0, 0.8)');
    cue.getBoundingClientRect = () => ({ left: 250, right: 700, top: 440, bottom: 474, width: 450, height: 34 }) as DOMRect;
    placeCredit(player, 'rtl');
    expect(player.style.getPropertyValue('--fanous-credit-end')).toBe('250px');
    // Small text never goes under 11px
    const small = document.createElement('div');
    small.innerHTML = '<div class="vjs-text-track-display"><div class="vjs-text-track-cue"><div style="font-size:12px">cue</div></div></div>';
    small.getBoundingClientRect = player.getBoundingClientRect;
    small.querySelector<HTMLElement>('.vjs-text-track-cue > div')!.getBoundingClientRect = cue.getBoundingClientRect;
    placeCredit(small, 'rtl');
    expect(small.style.getPropertyValue('--fanous-credit-size')).toBe('11px');
  });
});

describe('useQuranCaptionCredit', () => {
  it('lifts the credit off loaded cues, then is on only while such a cue shows', () => {
    const quran = { text: '﴿ٱللَّهُ ٱلصَّمَدُ﴾ (الإخلاص ١١٢:٢)\n‏المصدر: مؤسسة القرآن' };
    const speech = { text: 'and then he said' };
    const track = fakeTrack([speech, quran]);
    const f = fakePlayer(track);
    const { result, unmount } = renderHook(() => useQuranCaptionCredit(f.player, true));
    expect(quran.text).toBe('﴿ٱللَّهُ ٱلصَّمَدُ﴾ (الإخلاص ١١٢:٢)');
    expect(result.current.showing).toBe(false);

    act(() => { track.activeCues = [quran]; track.fire('cuechange'); });
    expect(result.current.showing).toBe(true);
    // The credit follows the cue's language and direction
    expect(result.current.language).toBe('ar');
    expect(result.current.dir).toBe('rtl');
    expect(f.classes.has(CAPTION_CREDIT_CLASS)).toBe(true);

    act(() => { track.activeCues = [speech]; track.fire('cuechange'); });
    expect(result.current.showing).toBe(false);
    expect(f.classes.has(CAPTION_CREDIT_CLASS)).toBe(false);
    unmount();
  });

  it('a cue that arrives with the credit while showing is redrawn without it', () => {
    const track = fakeTrack([]);
    const f = fakePlayer(track);
    const { result } = renderHook(() => useQuranCaptionCredit(f.player, true));
    const late = { text: '“Allah, the Eternal Refuge.”\nSource: Quran Foundation' };
    act(() => { track.cues.push(late); track.activeCues = [late]; track.fire('cuechange'); });
    expect(late.text).toBe('“Allah, the Eternal Refuge.”');
    expect(f.updateDisplay).toHaveBeenCalled();
    expect(result.current.showing).toBe(true);
  });

  it('does nothing before the player is ready', () => {
    const { result } = renderHook(() => useQuranCaptionCredit(null, false));
    expect(result.current.showing).toBe(false);
  });
});
