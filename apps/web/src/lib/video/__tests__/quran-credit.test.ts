/**
 * QF's short credit in the web player (QF 2026-11-23): the credit line comes off served cues and the
 * player shows it as a link while a credited cue is on screen (lib/video/quran-credit.ts).
 */
import { activeCueCredited, liftQuranCredits, showingCaptionTrack, trackHasQuranCredit } from '../quran-credit';

const quranCue = () => ({ text: '﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾ (الإخلاص ١١٢:١)\n‏المصدر: مؤسسة القرآن' });
const speechCue = () => ({ text: 'Say: He is Allah, the One' });

describe('Quran Foundation credit in the web player', () => {
  it('takes the credit line off each QF cue once, leaving the text', () => {
    const q = quranCue();
    const s = speechCue();
    const track = { kind: 'subtitles', mode: 'showing', cues: [s, q], activeCues: [] as Array<{ text: string }> };
    expect(liftQuranCredits(track)).toBe(true);
    expect(q.text).toBe('﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾ (الإخلاص ١١٢:١)');
    expect(s.text).toBe('Say: He is Allah, the One');
    // Done once: nothing changes the second time
    expect(liftQuranCredits(track)).toBe(false);
    expect(trackHasQuranCredit(track)).toBe(true);
  });

  it('is on while a credited cue is on screen, off otherwise', () => {
    const q = { text: 'Say, “He is Allah, [who is] One”\nSource: Quran Foundation' };
    const s = speechCue();
    const track = { kind: 'captions', mode: 'showing', cues: [s, q], activeCues: [s] as Array<{ text: string }> };
    liftQuranCredits(track);
    expect(activeCueCredited(track)).toBe(false);
    track.activeCues = [q];
    expect(activeCueCredited(track)).toBe(true);
    expect(activeCueCredited(null)).toBe(false);
  });

  it('a track without QF text has no credit', () => {
    const track = { kind: 'subtitles', mode: 'showing', cues: [speechCue()] };
    expect(liftQuranCredits(track)).toBe(false);
    expect(trackHasQuranCredit(track)).toBe(false);
  });

  it('finds the shown caption track (not chapters or metadata)', () => {
    const a = { kind: 'chapters', mode: 'showing' };
    const b = { kind: 'subtitles', mode: 'disabled' };
    const c = { kind: 'subtitles', mode: 'showing' };
    expect(showingCaptionTrack([a, b, c])).toBe(c);
    expect(showingCaptionTrack([a, b])).toBeNull();
  });
});
