/**
 * Times the video player shows (#1541): the control bar's current time and duration, the seek
 * tooltip, the live badge's "behind live" time, keyboard and touch feedback, and Video.js's own
 * seek-bar text. All of them go through locale-format, so Arabic pages read Eastern Arabic (Hindi)
 * numerals «١:٠٢:٠٥» and English pages Arabic numerals "1:02:05".
 *
 * A clock reads left to right in Arabic too: hours, minutes, seconds, and the current time before
 * the duration. The elements that show one are `dir="ltr"` (the control bar already is).
 */
import { formatClock, formatNumber, formatPercent, formatUnit, numberFormat, type FormatLocale } from '@al-ummah/shared-types';

/** A player position in whole seconds (floored, as Video.js does): 65.9 -> "1:05" / «١:٠٥». */
export function formatPlayerTime(locale: FormatLocale, seconds: number): string {
  return formatClock(locale, Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0)));
}

/** How far behind the live edge, as the seek tooltip shows it: "-1:05" / «-١:٠٥». */
export function formatBehindLive(locale: FormatLocale, seconds: number): string {
  return `-${formatPlayerTime(locale, seconds)}`;
}

/**
 * Video.js's `formatTime(seconds, guide)` in the locale's digits, with Video.js's own layout: hours
 * when the time or the guide has them, two-digit minutes after hours or when the guide has ten
 * minutes or more, and "-:-" for an unknown time. English output is exactly Video.js's default.
 */
export function videojsTimeFormatter(locale: FormatLocale): (seconds: number, guide: number) => string {
  return (seconds: number, guide: number) => {
    const plain = numberFormat(locale, { useGrouping: false });
    const two = numberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
    // As Video.js: an infinite guide (a live duration) shows hours, NaN shows none
    const gm = Math.floor((guide / 60) % 60);
    const gh = Math.floor(guide / 3600);
    if (Number.isNaN(seconds) || seconds === Infinity) return `${gh > 0 ? '-:' : ''}-:-`;
    const t = seconds < 0 ? 0 : seconds;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t / 60) % 60);
    const s = Math.floor(t % 60);
    const hours = h > 0 || gh > 0;
    const minutes = hours || gm >= 10 ? two.format(m) : plain.format(m);
    return `${hours ? `${plain.format(h)}:` : ''}${minutes}:${two.format(s)}`;
  };
}

/** A seek step with its sign: "+10s" / «+١٠ ث». */
export function formatSeekStep(locale: FormatLocale, seconds: number): string {
  return formatUnit(locale, seconds, 'second', { unitDisplay: 'narrow', signDisplay: 'always', maximumFractionDigits: 0 });
}

/** A playback rate: 1.5 -> "1.5x" / «١٫٥x» (`sign` sets the multiplication mark). */
export function formatPlaybackRate(locale: FormatLocale, rate: number, sign = 'x'): string {
  return `${formatNumber(locale, rate, { maximumFractionDigits: 2 })}${sign}`;
}

/** A 0–1 level (volume) or 0–100 share as a whole percentage: "50%" / «٥٠٪». */
export function formatLevel(locale: FormatLocale, ratio: number): string {
  return formatPercent(locale, ratio);
}
