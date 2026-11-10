/**
 * Resume playback rules (#242).
 *
 * A resume point is only recorded after real playback (RESUME_MIN_WATCHED_SECONDS
 * of the media actually playing in this page), and only offered when it is
 * meaningfully into the video and not essentially finished. Opening a page,
 * a `t=` link, a muted preview that never plays, or scrubbing the bar without
 * playing records nothing.
 */
import type { WatchProgress } from '@/services/api/watch-history';

/** Seconds of real playback in this page before any progress is saved. */
export const RESUME_MIN_WATCHED_SECONDS = 10;
/** A saved position earlier than this is not worth resuming. */
export const RESUME_MIN_POSITION_SECONDS = 10;
/** Above this share of the video it counts as watched; start from the beginning. */
export const RESUME_MAX_RATIO = 0.95;
/** Nor resume within the final seconds (credits, outro) of any video. */
export const RESUME_END_MARGIN_SECONDS = 10;
/**
 * The "Start from beginning" pill stays until playback is this far past the
 * resume point; by then the viewer has chosen to carry on.
 */
export const START_OVER_GRACE_SECONDS = 30;
/**
 * A timeupdate step larger than this is a seek or a stall, not playback
 * (timeupdate fires every ~250 ms, so even 4x speed stays well below it).
 */
const MAX_PLAYBACK_STEP_SECONDS = 1.5;

/** The position to open the player at, or null to start from the beginning. */
export function resumePosition(
  progress: Pick<WatchProgress, 'currentTime' | 'duration' | 'completed'> | null | undefined,
  isLive = false,
  isShort = false
): number | null {
  // Shorts (Lamahat; shared rule in shared-types video-format.ts) always start from the beginning
  if (!progress || isLive || isShort || progress.completed) return null;
  const { currentTime, duration } = progress;
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return null;
  if (currentTime < RESUME_MIN_POSITION_SECONDS) return null;
  if (currentTime / duration > RESUME_MAX_RATIO) return null;
  if (duration - currentTime < RESUME_END_MARGIN_SECONDS) return null;
  return currentTime;
}

/**
 * Seconds of real playback between two timeupdate positions: the forward step
 * when it is a normal playback step, 0 for seeks, rewinds and stalls.
 */
export function playbackStep(previousTime: number | null, currentTime: number): number {
  if (previousTime === null || !Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return 0;
  const step = currentTime - previousTime;
  return step > 0 && step <= MAX_PLAYBACK_STEP_SECONDS ? step : 0;
}

/** Whether a watch has played long enough to record a resume point. */
export function hasWatchedEnough(watchedSeconds: number): boolean {
  return watchedSeconds >= RESUME_MIN_WATCHED_SECONDS;
}

/**
 * Whether the "Start from beginning" pill still applies at `currentTime` after
 * the player opened at `resumeAt`. It goes once the viewer is back at the
 * start or has played on well past the resume point.
 */
export function startOverStillRelevant(resumeAt: number, currentTime: number): boolean {
  if (!Number.isFinite(currentTime)) return true;
  return currentTime >= 1 && currentTime < resumeAt + START_OVER_GRACE_SECONDS;
}

/** m:ss or h:mm:ss for announcements. */
export function formatResumeTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
