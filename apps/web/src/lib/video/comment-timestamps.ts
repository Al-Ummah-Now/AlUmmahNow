/**
 * Comment timestamps (Story 29.2): "12:34" or "1:02:03" in a comment becomes
 * a link that seeks the watch-page player.
 *
 * The comment and the player are decoupled through a window event so any
 * player on the page can respond: dispatchPlayerSeek() fires
 * PLAYER_SEEK_EVENT with { videoId, seconds }.
 */

export const PLAYER_SEEK_EVENT = 'aun:player-seek';

export interface PlayerSeekDetail {
  videoId: string;
  seconds: number;
}

export type CommentSegment =
  | { type: 'text'; value: string }
  | { type: 'timestamp'; value: string; seconds: number };

// h:mm:ss or m:ss / mm:ss, not part of a longer number or word (e.g. 10:30am stays a timestamp; 1:2345 does not)
const TIMESTAMP = /(?<![\w:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g;

/** Seconds for a matched timestamp, or null when a field is out of range. */
export function timestampToSeconds(hours: string | undefined, minutes: string, seconds: string): number | null {
  const h = hours ? Number(hours) : 0;
  const m = Number(minutes);
  const s = Number(seconds);
  if (s > 59) return null;
  if (hours !== undefined && m > 59) return null;
  return h * 3600 + m * 60 + s;
}

/** Split comment text into plain text and timestamp segments. */
export function parseCommentTimestamps(text: string, maxSeconds?: number): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TIMESTAMP)) {
    const index = match.index ?? 0;
    const seconds = timestampToSeconds(match[1], match[2], match[3]);
    if (seconds === null || (maxSeconds !== undefined && maxSeconds > 0 && seconds > maxSeconds)) continue;
    if (index > last) segments.push({ type: 'text', value: text.slice(last, index) });
    segments.push({ type: 'timestamp', value: match[0], seconds });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}

export function dispatchPlayerSeek(detail: PlayerSeekDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PlayerSeekDetail>(PLAYER_SEEK_EVENT, { detail }));
}
