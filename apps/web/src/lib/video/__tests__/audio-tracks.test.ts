/**
 * Audio tracks in the player (wiki AUN-MULTI-AUDIO MA7): the first track, the menu names, the
 * saved choice and the API data the watch page and embeds keep.
 */
import type { AudioTrackView } from '@al-ummah/shared-types';
import {
  AUDIO_PREF_KEY,
  audioTrackLabel,
  audioTracksOf,
  enableAudioTrack,
  matchTracks,
  pickAudioTrack,
  readAudioPreference,
  videoLanguages,
  writeAudioPreference,
} from '../audio-tracks';

const ORIG: AudioTrackView = { id: 'orig', language: 'ar', label: 'العربية', kind: 'original', isDefault: true };
const EN: AudioTrackView = { id: 'ten1234567890', language: 'en', label: 'English', kind: 'dub', isDefault: false };
const EN_DESC: AudioTrackView = { id: 'tde1234567890', language: 'en', label: 'English', kind: 'description', isDefault: false };
const UR: AudioTrackView = { id: 'tur1234567890', language: 'ur', label: 'اردو', kind: 'dub', isDefault: false };
const ALL = [ORIG, EN, EN_DESC, UR];

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('pickAudioTrack', () => {
  it('plays the saved choice first when the video has it', () => {
    expect(pickAudioTrack(ALL, { saved: { language: 'ur', kind: 'dub' }, siteLanguage: 'en' })).toBe(3);
    expect(pickAudioTrack(ALL, { saved: { language: 'en', kind: 'description' }, siteLanguage: 'ar' })).toBe(2);
  });
  it('falls back to the saved language, never into audio description by language alone', () => {
    expect(pickAudioTrack(ALL, { saved: { language: 'en', kind: 'commentary' }, siteLanguage: 'ar' })).toBe(1);
    expect(pickAudioTrack([ORIG, EN_DESC], { saved: { language: 'en', kind: 'dub' }, siteLanguage: 'ar' })).toBe(0);
  });
  it('without a saved choice, prefers the site language (original, then a dub)', () => {
    expect(pickAudioTrack(ALL, { saved: null, siteLanguage: 'en' })).toBe(1);
    expect(pickAudioTrack(ALL, { saved: null, siteLanguage: 'ar' })).toBe(0);
  });
  it('else the creator default; nothing to pick with one track', () => {
    expect(pickAudioTrack([ORIG, { ...UR, isDefault: false }], { saved: null, siteLanguage: 'fr' })).toBe(0);
    expect(pickAudioTrack([{ ...ORIG, isDefault: false }, { ...UR, isDefault: true }], { saved: null, siteLanguage: 'fr' })).toBe(1);
    expect(pickAudioTrack([ORIG], { saved: null, siteLanguage: 'en' })).toBeNull();
  });
});

describe('matchTracks', () => {
  it('matches by position when the counts agree (the master order)', () => {
    expect(matchTracks([{ enabled: true }, { enabled: false }], [ORIG, EN])).toEqual([ORIG, EN]);
  });
  it('matches by language and name otherwise', () => {
    expect(matchTracks([{ language: 'en', label: 'English', enabled: false }, { language: 'fr', enabled: false }], ALL)).toEqual([EN, null]);
  });
});

describe('audioTrackLabel', () => {
  const kind = (k: string) => ({ original: 'Original', dub: 'Dubbed', commentary: 'Commentary', description: 'Audio description' })[k]!;
  it('names a track "label · kind"', () => {
    expect(audioTrackLabel(EN, { enabled: false }, kind as never, 1)).toBe('English · Dubbed');
    expect(audioTrackLabel(ORIG, { enabled: true }, kind as never, 0)).toBe('العربية · Original');
  });
  it('keeps a label that already says its kind, and the player label without metadata', () => {
    expect(audioTrackLabel({ ...EN_DESC, label: 'Audio description (English)' }, { enabled: false }, kind as never, 2)).toBe('Audio description (English)');
    expect(audioTrackLabel(null, { label: 'Track', enabled: false }, kind as never, 4)).toBe('Track');
    expect(audioTrackLabel(null, { enabled: false }, kind as never, 4)).toBe('5');
  });
});

describe('saved choice', () => {
  it('round-trips language and kind; ignores junk and blocked storage', () => {
    const s = memory();
    writeAudioPreference({ language: 'ur', kind: 'dub' }, s);
    expect(readAudioPreference(s)).toEqual({ language: 'ur', kind: 'dub' });
    s.m.set(AUDIO_PREF_KEY, '{"language":"<x>","kind":"dub"}');
    expect(readAudioPreference(s)).toBeNull();
    s.m.set(AUDIO_PREF_KEY, 'not json');
    expect(readAudioPreference(s)).toBeNull();
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readAudioPreference(blocked)).toBeNull();
    expect(() => writeAudioPreference({ language: 'en', kind: 'dub' }, blocked)).not.toThrow();
  });
});

describe('enableAudioTrack', () => {
  it('enables exactly one track', () => {
    const tracks = [{ enabled: true }, { enabled: false }, { enabled: false }];
    enableAudioTrack(tracks, 2);
    expect(tracks.map((t) => t.enabled)).toEqual([false, false, true]);
  });
});

describe('API data', () => {
  it('keeps well-formed tracks only, and only two or more', () => {
    expect(audioTracksOf([ORIG, EN])).toEqual([ORIG, EN]);
    expect(audioTracksOf([ORIG])).toEqual([]);
    expect(audioTracksOf([ORIG, { ...EN, kind: 'karaoke' }])).toEqual([]);
    expect(audioTracksOf('x')).toEqual([]);
  });
  it('inLanguage lists every audio language, else the page language', () => {
    expect(videoLanguages(ALL, 'en')).toEqual(['ar', 'en', 'ur']);
    expect(videoLanguages(undefined, 'ar')).toBe('ar');
  });
});
