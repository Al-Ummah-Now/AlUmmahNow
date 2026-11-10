/**
 * Short vs video: the one rule every app uses.
 *
 * Owner decision (2026-11-09): a Short is at most SHORT_MAX_SECONDS (3 min) long
 * AND vertical or square (encoded height >= width). It is detected from the
 * duration and the encoded resolution Bunny reports when processing completes.
 * The uploader can choose "Upload as Short" or "Upload as video" at upload and
 * in edit; that choice (`format`) always wins.
 *
 * Without a duration or the encoded dimensions a video cannot be detected; it
 * is treated as a video (`source: 'unknown'`) until processing stores them or
 * an admin sets the format. Live streams are never Shorts.
 */

/** Longest a Short can be, in seconds (inclusive). */
export const SHORT_MAX_SECONDS = 180;

export const VIDEO_FORMATS = ['short', 'video'] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

/** How the format was decided. */
export type VideoFormatSource = 'override' | 'auto' | 'live' | 'unknown';

/** Fields of a video record the rule reads. */
export interface VideoFormatInput {
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  /** Uploader / admin choice; absent (or anything else) = detect automatically. */
  format?: unknown;
  isLive?: boolean | null;
}

export interface VideoFormatResult {
  format: VideoFormat;
  source: VideoFormatSource;
  /** Set when source is 'unknown': what detection was missing. */
  missing?: Array<'duration' | 'dimensions'>;
}

export function isVideoFormat(value: unknown): value is VideoFormat {
  return value === 'short' || value === 'video';
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Decide whether a video is a Short, and why. */
export function classifyVideoFormat(video: VideoFormatInput | null | undefined): VideoFormatResult {
  if (!video) return { format: 'video', source: 'unknown', missing: ['duration', 'dimensions'] };
  if (video.isLive) return { format: 'video', source: 'live' };
  if (isVideoFormat(video.format)) return { format: video.format, source: 'override' };

  const duration = positive(video.duration);
  const width = positive(video.width);
  const height = positive(video.height);
  // Longer than a Short can be: a video, whatever its shape
  if (duration !== null && duration > SHORT_MAX_SECONDS) return { format: 'video', source: 'auto' };
  // Wider than tall: a video, whatever its length
  if (width !== null && height !== null && height < width) return { format: 'video', source: 'auto' };

  const missing: Array<'duration' | 'dimensions'> = [];
  if (duration === null) missing.push('duration');
  if (width === null || height === null) missing.push('dimensions');
  if (missing.length) return { format: 'video', source: 'unknown', missing };
  return { format: 'short', source: 'auto' };
}

/** True when the video is a Short (see classifyVideoFormat). */
export function isShort(video: VideoFormatInput | null | undefined): boolean {
  return classifyVideoFormat(video).format === 'short';
}

/**
 * isShort for objects that may carry the flag already computed by this rule
 * (search/section index payloads keep `isShort` but not the dimensions).
 */
export function isShortOrFlag(video: (VideoFormatInput & { isShort?: unknown }) | null | undefined): boolean {
  return typeof video?.isShort === 'boolean' ? video.isShort : isShort(video);
}

/**
 * True when a ready video still needs processing data (duration or encoded
 * dimensions) to be classified automatically: re-check it at Bunny, and flag
 * it for an admin if Bunny cannot supply them.
 */
export function needsFormatData(video: VideoFormatInput | null | undefined): boolean {
  return classifyVideoFormat(video).source === 'unknown';
}
