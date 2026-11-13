/**
 * A seek that never finishes is tried again.
 *
 * Firefox (Media Source playback through VHS) was seen to drop a seek made as the player paused:
 * Video.js logged an error, the spinner stayed and the position never reached the target, with
 * every segment fetched (Player E2E, controls › "a seek made as the player pauses", #1137). VHS's
 * playback watcher only fixes stalls while playing, so a paused player stayed stuck. Viewers
 * pause and seek in one step all the time (chapter jumps, resume, the seek keys).
 *
 * A seek still pending after `stuckAfterMs` is stuck when its target is already buffered, or when
 * nothing was downloaded since the last check (`progress`: VHS's media bytes transferred); the same
 * target is then sought again, at most `maxRetries` times per seek. A seek whose data is still
 * arriving is left alone: a re-seek would restart that download on a slow connection.
 */

export interface SeekablePlayer {
  on(event: 'seeking' | 'seeked' | 'dispose', handler: () => void): void;
  off(event: 'seeking' | 'seeked', handler: () => void): void;
  seeking(): boolean;
  buffered(): TimeRanges;
  currentTime(): number;
  currentTime(seconds: number): void;
  isDisposed(): boolean;
}

export const SEEK_STUCK_AFTER_MS = 4000;
export const SEEK_MAX_RETRIES = 2;

/** Whether `time` lies in one of the buffered ranges */
export function isBuffered(ranges: TimeRanges, time: number): boolean {
  for (let i = 0; i < ranges.length; i++) {
    if (time >= ranges.start(i) && time <= ranges.end(i)) return true;
  }
  return false;
}

export function recoverStuckSeeks(
  player: SeekablePlayer,
  opts: {
    stuckAfterMs?: number;
    maxRetries?: number;
    /** A counter that grows while media data arrives (NaN when unknown, e.g. native HLS) */
    progress?: () => number;
    onRetry?: (target: number, attempt: number) => void;
  } = {},
): () => void {
  const stuckAfterMs = opts.stuckAfterMs ?? SEEK_STUCK_AFTER_MS;
  const maxRetries = opts.maxRetries ?? SEEK_MAX_RETRIES;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let target = 0;
  let retries = 0;
  // Our own re-seek fires `seeking` again: it must not reset the count
  let reseeking = false;
  let lastProgress = NaN;
  const readProgress = () => {
    try {
      return opts.progress?.() ?? NaN;
    } catch {
      return NaN;
    }
  };

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const check = () => {
    timer = null;
    if (player.isDisposed() || !player.seeking()) return;
    if (retries >= maxRetries) return;
    const progress = readProgress();
    const downloading = !Number.isFinite(progress) || !Number.isFinite(lastProgress) || progress !== lastProgress;
    lastProgress = progress;
    // Data still arriving (or no way to tell): slow, not stuck; check again later
    if (!isBuffered(player.buffered(), target) && downloading) {
      timer = setTimeout(check, stuckAfterMs);
      return;
    }
    retries += 1;
    opts.onRetry?.(target, retries);
    reseeking = true;
    player.currentTime(target);
    reseeking = false;
    timer = setTimeout(check, stuckAfterMs);
  };

  const onSeeking = () => {
    if (reseeking) return;
    clear();
    target = player.currentTime();
    retries = 0;
    lastProgress = readProgress();
    timer = setTimeout(check, stuckAfterMs);
  };
  const onSeeked = () => clear();

  player.on('seeking', onSeeking);
  player.on('seeked', onSeeked);
  player.on('dispose', clear);
  return () => {
    clear();
    player.off('seeking', onSeeking);
    player.off('seeked', onSeeked);
  };
}
