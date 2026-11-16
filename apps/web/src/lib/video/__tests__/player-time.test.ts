/**
 * @jest-environment jsdom
 *
 * The player's times in the page's digits (#1541): Arabic pages read Eastern Arabic (Hindi)
 * numerals ٠–٩ with the clock in its usual order (hours, minutes, seconds; current time before
 * the duration), English pages are unchanged.
 */
import { hasArabicNumerals } from '@al-ummah/shared-types';
import { formatBehindLive, formatLevel, formatPlaybackRate, formatPlayerTime, formatSeekStep, videojsTimeFormatter } from '../player-time';
import { formatTime } from '../progress-preview';
import { speedLabel, speedOptions } from '../settings-model';
import { formatTimestamp } from '@/lib/embed/snippets';

jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toWestern = (text: string) => text.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

describe('player time in Arabic', () => {
  it.each([0, 5, 65, 599, 1325, 3600, 3725, 36000 + 61])('%s s has no 0–9 and reads like the English clock', (s) => {
    const ar = formatPlayerTime('ar', s);
    expect(hasArabicNumerals(ar)).toBe(false);
    expect(toWestern(ar)).toBe(formatPlayerTime('en', s));
  });

  it('keeps hours, minutes and seconds in order', () => {
    expect(formatPlayerTime('ar', 3725)).toBe('١:٠٢:٠٥');
    expect(formatPlayerTime('ar', 1325)).toBe('٢٢:٠٥');
    expect(formatPlayerTime('ar', 0)).toBe('٠:٠٠');
  });

  it('floors like Video.js and treats bad input as 0:00', () => {
    expect(formatPlayerTime('en', 65.9)).toBe('1:05');
    expect(formatPlayerTime('ar', Number.NaN)).toBe('٠:٠٠');
    expect(formatPlayerTime('en', -4)).toBe('0:00');
  });

  it('the seek tooltip and live badge times are Arabic too', () => {
    expect(formatTime(65, 'ar')).toBe('١:٠٥');
    expect(formatBehindLive('ar', 42)).toBe('-٠:٤٢');
    expect(formatBehindLive('en', 42)).toBe('-0:42');
  });

  it('feedback numbers (seek step, volume, speed) have no 0–9', () => {
    for (const text of [formatSeekStep('ar', 10), formatSeekStep('ar', -5), formatLevel('ar', 0.5), formatPlaybackRate('ar', 1.25), speedLabel(1.5, 'عادي', 'ar')]) {
      expect(hasArabicNumerals(text)).toBe(false);
    }
    expect(speedLabel(1, 'عادي', 'ar')).toBe('عادي');
    expect(speedOptions([0.5, 1, 2], 'عادي', 'ar').map((o) => o.label)).toEqual(['٠٫٥×', 'عادي', '٢×']);
    expect(formatTimestamp(754, 'ar')).toBe('١٢:٣٤');
  });
});

describe('player time in English is unchanged', () => {
  it('keeps the old strings', () => {
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3665)).toBe('1:01:05');
    expect(formatSeekStep('en', 10)).toBe('+10s');
    expect(formatSeekStep('en', -10)).toBe('-10s');
    expect(formatLevel('en', 0.7)).toBe('70%');
    expect(formatPlaybackRate('en', 1.5)).toBe('1.5x');
    expect(speedLabel(1.5, 'Normal')).toBe('1.5×');
    expect(formatTimestamp(3723)).toBe('1:02:03');
  });
});

describe('Video.js formatTime', () => {
  type Vjs = { time: { formatTime(s: number, g?: number): string; resetFormatTime(): void } };
  const mod = jest.requireActual('video.js') as Vjs & { default?: Vjs };
  const vjs = mod.default ?? mod;
  const en = videojsTimeFormatter('en');
  const ar = videojsTimeFormatter('ar');

  it.each([
    [0, 0], [5, 5], [65, 65], [65, 1325], [125, 600], [59, 3600], [3725, 3725], [3725, 0],
    [Number.NaN, 0], [Number.NaN, 3600], [Infinity, 1325], [-3, 10], [1325, Infinity],
  ])('English matches Video.js for (%s, %s)', (s, g) => {
    vjs.time.resetFormatTime();
    expect(en(s, g)).toBe(vjs.time.formatTime(s, g));
  });

  it('Arabic follows the same layout in ٠–٩', () => {
    expect(ar(0, 1325)).toBe('٠٠:٠٠');
    expect(ar(0, 0)).toBe('٠:٠٠');
    expect(ar(1325, 1325)).toBe('٢٢:٠٥');
    expect(ar(3725, 3725)).toBe('١:٠٢:٠٥');
    expect(ar(Number.NaN, 0)).toBe('-:-');
    for (const s of [0, 65, 1325, 3725]) expect(toWestern(ar(s, s))).toBe(en(s, s));
  });

  it('createVideoPlayer installs the page language into Video.js', () => {
    const { setPlayerTimeLanguage } = jest.requireActual('../videojs-setup') as { setPlayerTimeLanguage(l: 'en' | 'ar'): void };
    setPlayerTimeLanguage('ar');
    expect(vjs.time.formatTime(1325)).toBe('٢٢:٠٥');
    setPlayerTimeLanguage('en');
    expect(vjs.time.formatTime(1325)).toBe('22:05');
  });
});
