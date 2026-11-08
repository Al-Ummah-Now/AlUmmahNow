/**
 * Resume playback rule (#242): offer to continue from a saved position only
 * when it is meaningfully into the video and not essentially finished.
 */
import type { WatchProgress } from '@/services/api/watch-history';

/** Below this share of the video, starting over loses nothing. */
export const RESUME_MIN_RATIO = 0.05;
/** Above this share the video counts as watched; start from the beginning. */
export const RESUME_MAX_RATIO = 0.95;

/** The position to offer, or null when the prompt should not be shown. */
export function resumePosition(
  progress: Pick<WatchProgress, 'currentTime' | 'duration' | 'completed'> | null | undefined,
  isLive = false
): number | null {
  if (!progress || isLive || progress.completed) return null;
  const { currentTime, duration } = progress;
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return null;
  const ratio = currentTime / duration;
  return ratio >= RESUME_MIN_RATIO && ratio <= RESUME_MAX_RATIO ? currentTime : null;
}
