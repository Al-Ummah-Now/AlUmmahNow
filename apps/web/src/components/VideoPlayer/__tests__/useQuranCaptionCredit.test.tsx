/**
 * The player shows QF's credit link while a cue with Quran text from QF is on screen, and the caption
 * itself no longer carries the credit line (QF 2026-11-23).
 */
import { act, renderHook } from '@testing-library/react';
import { CAPTION_CREDIT_CLASS, useQuranCaptionCredit } from '../useQuranCaptionCredit';

function fakeTrack(cues: Array<{ text: string }>) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    kind: 'subtitles',
    mode: 'showing',
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

describe('useQuranCaptionCredit', () => {
  it('lifts the credit off loaded cues, then is on only while such a cue shows', () => {
    const quran = { text: '﴿ٱللَّهُ ٱلصَّمَدُ﴾ (الإخلاص ١١٢:٢)\n‏المصدر: مؤسسة القرآن' };
    const speech = { text: 'and then he said' };
    const track = fakeTrack([speech, quran]);
    const f = fakePlayer(track);
    const { result, unmount } = renderHook(() => useQuranCaptionCredit(f.player, true));
    expect(quran.text).toBe('﴿ٱللَّهُ ٱلصَّمَدُ﴾ (الإخلاص ١١٢:٢)');
    expect(result.current).toBe(false);

    act(() => { track.activeCues = [quran]; track.fire('cuechange'); });
    expect(result.current).toBe(true);
    expect(f.classes.has(CAPTION_CREDIT_CLASS)).toBe(true);

    act(() => { track.activeCues = [speech]; track.fire('cuechange'); });
    expect(result.current).toBe(false);
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
    expect(result.current).toBe(true);
  });

  it('does nothing before the player is ready', () => {
    const { result } = renderHook(() => useQuranCaptionCredit(null, false));
    expect(result.current).toBe(false);
  });
});
