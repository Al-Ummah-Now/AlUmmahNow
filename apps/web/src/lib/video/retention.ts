/**
 * Retention tracking for creator analytics (docs/specs/CREATOR-STUDIO.md §8.4).
 *
 * Fed from the player's `timeupdate` while playing. A video is split into equal
 * buckets; a session reports each bucket once, the first time real playback
 * passes through it. Seeks don't fill the buckets they skip, and sessions that
 * didn't start at the beginning (a resume, for example) are left out, so every
 * reported bucket has a matching start.
 */

import { RETENTION_BUCKET_COUNT } from '@al-ummah/shared-types';
import { MAX_TICK_SECONDS } from './watch-time';

export class RetentionTracker {
  private readonly reached = new Set<number>();
  private unsent = new Set<number>();
  private last: { media: number; wall: number; bucket: number } | null = null;

  /** Media position and duration (s) and wall time (ms) from a timeupdate while playing. */
  tick(mediaTime: number, duration: number, nowMs: number): void {
    if (!Number.isFinite(mediaTime) || !Number.isFinite(duration) || !Number.isFinite(nowMs)) return;
    if (duration <= 0 || mediaTime < 0) return;

    const bucket = Math.min(RETENTION_BUCKET_COUNT - 1, Math.floor((mediaTime / duration) * RETENTION_BUCKET_COUNT));
    const previous = this.last;
    this.last = { media: mediaTime, wall: nowMs, bucket };

    if (this.reached.size === 0 && bucket !== 0) return;
    if (previous && this.isContinuous(previous, mediaTime, nowMs)) {
      for (let b = previous.bucket; b <= bucket; b++) this.reach(b);
    } else {
      this.reach(bucket);
    }
  }

  private isContinuous(previous: { media: number; wall: number }, mediaTime: number, nowMs: number): boolean {
    const mediaDelta = mediaTime - previous.media;
    const wallDelta = (nowMs - previous.wall) / 1000;
    return mediaDelta > 0 && wallDelta > 0 && wallDelta <= MAX_TICK_SECONDS && mediaDelta <= wallDelta * 2 + 0.5;
  }

  private reach(bucket: number): void {
    if (this.reached.has(bucket)) return;
    this.reached.add(bucket);
    this.unsent.add(bucket);
  }

  /** Pause, seek or end: the next tick starts a new run. */
  break(): void {
    this.last = null;
  }

  get pending(): number {
    return this.unsent.size;
  }

  /** Buckets not reported yet, in order; empties the list. */
  drain(): number[] {
    const buckets = [...this.unsent].sort((a, b) => a - b);
    this.unsent = new Set();
    return buckets;
  }
}

export interface RetentionEvent {
  eventType?: string;
  videoId?: unknown;
  sessionId?: unknown;
  data?: { buckets?: unknown };
}

/** The reports in a batch that api-videos accepts. */
export function retentionReports(events: RetentionEvent[]): Array<{ videoId: string; sessionId: string; buckets: number[] }> {
  return events.flatMap((e) => {
    const buckets = e?.data?.buckets;
    if (e?.eventType !== 'retention' || typeof e.videoId !== 'string' || !e.videoId) return [];
    if (typeof e.sessionId !== 'string' || !e.sessionId) return [];
    if (!Array.isArray(buckets) || buckets.length === 0) return [];
    if (!buckets.every((b) => Number.isInteger(b) && b >= 0 && b < RETENTION_BUCKET_COUNT)) return [];
    return [{ videoId: e.videoId, sessionId: e.sessionId, buckets: buckets as number[] }];
  });
}
