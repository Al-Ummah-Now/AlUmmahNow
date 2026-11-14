import type { CaptionCue } from '@al-ummah/shared-types';
import {
  acceptAllConfident,
  acceptSpan,
  commit,
  confidentCount,
  countMatches,
  formatCueTime,
  initHistory,
  mergeNext,
  nudge,
  parseShortReference,
  redo,
  rejectSpan,
  replaceAll,
  setSpanRange,
  setSpeechText,
  splitCue,
  undo,
} from '../editor-state';

/** A segment's fields, for assertions */
const seg = (s: unknown) => s as Record<string, unknown>;

const cues = (): CaptionCue[] => [
  { id: 'a', startMs: 0, endMs: 4000, segments: [{ type: 'speech', text: 'one two three four' }] },
  { id: 'b', startMs: 4000, endMs: 7000, segments: [{ type: 'quran', range: '112:1:1-112:1:4', status: 'confirmed', heard: 'قل هو الله احد' }] },
  { id: 'c', startMs: 7000, endMs: 9000, segments: [{ type: 'quran', range: '55:13:1-55:13:4', status: 'review', alternatives: ['55:16:1-55:16:4'] }] },
];

describe('caption editor edits', () => {
  it('edits text and keeps the history; typing in one field is one undo step', () => {
    let h = initHistory(cues());
    h = commit(h, setSpeechText(h.present, 'a', 0, 'one'), { key: 'a:0' });
    h = commit(h, setSpeechText(h.present, 'a', 0, 'one t'), { key: 'a:0', last: 'a:0' });
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(seg(h.present[0]!.segments[0]).text).toBe('one two three four');
    h = redo(h);
    expect(seg(h.present[0]!.segments[0]).text).toBe('one t');
  });

  it('nudges by 0.1 s, never below 0 and never shorter than 0.1 s', () => {
    expect(nudge(cues(), 'a', 'start', -100)[0]!.startMs).toBe(0);
    expect(nudge(cues(), 'a', 'end', 100)[0]!.endMs).toBe(4100);
    const short = [{ ...cues()[0]!, startMs: 1000, endMs: 1100 }];
    expect(nudge(short, 'a', 'start', 100)[0]!.startMs).toBe(1000);
    expect(nudge(short, 'a', 'end', -100)[0]!.endMs).toBe(1100);
  });

  it('merges with the next cue and splits at the caret by text share', () => {
    const merged = mergeNext(cues(), 'a');
    expect(merged).toHaveLength(2);
    expect(merged[0]!.endMs).toBe(7000);
    expect(merged[0]!.segments.map((s) => s.type)).toEqual(['speech', 'quran']);
    const split = splitCue(cues(), 'a', 0, 8); // "one two " | "three four"
    expect(split).toHaveLength(4);
    expect(seg(split[0]!.segments[0]).text).toBe('one two');
    expect(seg(split[1]!.segments[0]).text).toBe('three four');
    expect(split[0]!.endMs).toBe(split[1]!.startMs);
    expect(split[0]!.endMs).toBeGreaterThan(1000);
    expect(split[1]!.endMs).toBe(4000);
    expect(splitCue(cues(), 'a', 0, 0)).toHaveLength(3); // nothing before the caret
  });

  it('find and replace changes speech only, never a Quran span', () => {
    const withWord = cues();
    seg(withWord[1]!.segments[0]).heard = 'two';
    const { cues: next, count } = replaceAll(withWord, 'two', '2');
    expect(count).toBe(1);
    expect(seg(next[0]!.segments[0]).text).toBe('one 2 three four');
    expect(seg(next[1]!.segments[0]).heard).toBe('two');
    expect(countMatches(withWord, 'o')).toBe(3);
  });

  it('Quran: confirm, confirm all confident, different reference, not Quran', () => {
    expect(confidentCount(cues())).toBe(1);
    const all = acceptAllConfident(cues());
    expect(seg(all[1]!.segments[0]).status).toBe('accepted');
    expect(seg(all[2]!.segments[0]).status).toBe('review');
    expect(seg(acceptSpan(cues(), 'c', 0)[2]!.segments[0]).status).toBe('accepted');
    const moved = setSpanRange(cues(), 'c', 0, '55:16:1-55:16:4')[2]!.segments[0];
    expect(moved).toEqual({ type: 'quran', range: '55:16:1-55:16:4', status: 'accepted' });
    const rejected = rejectSpan(cues(), 'b', 0);
    expect(rejected[1]!.segments).toEqual([{ type: 'speech', text: 'قل هو الله احد' }]);
    expect(rejectSpan(cues(), 'c', 0)).toHaveLength(2); // nothing heard: the cue goes
  });

  it('formats times and reads typed references in either digit set', () => {
    expect(formatCueTime(61_400)).toBe('01:01.4');
    expect(formatCueTime(3_723_000)).toBe('1:02:03.0');
    expect(parseShortReference('3:166')).toBe('3:166');
    expect(parseShortReference(' 3 : 166 – 167 ')).toBe('3:166-167');
    expect(parseShortReference('٣:١٦٦-١٦٧')).toBe('3:166-167');
    expect(parseShortReference('115:1')).toBeNull();
    expect(parseShortReference('3:167-166')).toBeNull();
    expect(parseShortReference('three')).toBeNull();
  });
});
