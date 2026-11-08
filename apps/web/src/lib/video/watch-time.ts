/**
 * Played-time accumulator for watch-time analytics (#235).
 *
 * Fed from the player's `timeupdate` while playing. Counts real (wall-clock)
 * seconds between consecutive updates when the media position advanced by a
 * normal-playback amount, so seeks, stalls and a backgrounded tab never add
 * time. drain() hands the total out in chunks the API accepts (<= 60 s each).
 */

/** Gap between two updates still counted as continuous playback. */
export const MAX_TICK_SECONDS = 2;
/** api-videos rejects reports over this. */
export const MAX_REPORT_SECONDS = 60;

export class PlayedTimeAccumulator {
  private seconds = 0;
  private last: { media: number; wall: number } | null = null;

  /** Media position (s) and wall time (ms) from a timeupdate while playing. */
  tick(mediaTime: number, nowMs: number): void {
    if (!Number.isFinite(mediaTime) || !Number.isFinite(nowMs)) return;
    const prev = this.last;
    this.last = { media: mediaTime, wall: nowMs };
    if (!prev) return;
    const mediaDelta = mediaTime - prev.media;
    const wallDelta = (nowMs - prev.wall) / 1000;
    // Advanced forward by roughly what playback produces (up to 2x speed + jitter)
    if (mediaDelta <= 0 || wallDelta <= 0 || wallDelta > MAX_TICK_SECONDS || mediaDelta > wallDelta * 2 + 0.5) return;
    this.seconds += wallDelta;
  }

  /** Pause, seek or end: the next tick starts a new run. */
  break(): void {
    this.last = null;
  }

  get pending(): number {
    return this.seconds;
  }

  /** Chunks of whole-centisecond seconds (<= 60 each); resets the total. */
  drain(): number[] {
    let left = Math.round(this.seconds * 100) / 100;
    this.seconds = 0;
    const chunks: number[] = [];
    while (left >= 1) {
      const chunk = Math.min(left, MAX_REPORT_SECONDS);
      chunks.push(Math.round(chunk * 100) / 100);
      left = Math.round((left - chunk) * 100) / 100;
    }
    // Under a second is kept for the next drain rather than sent
    this.seconds = left;
    return chunks;
  }
}

export interface WatchTimeEvent {
  eventType?: string;
  videoId?: unknown;
  sessionId?: unknown;
  data?: { seconds?: unknown };
}

/** The reports in a batch that api-videos accepts (0 < seconds <= 60, a session). */
export function watchTimeReports(events: WatchTimeEvent[]): Array<{ videoId: string; sessionId: string; seconds: number }> {
  return events.flatMap((e) => {
    const seconds = Number(e?.data?.seconds);
    if (e?.eventType !== 'watch_time' || typeof e.videoId !== 'string' || !e.videoId) return [];
    if (typeof e.sessionId !== 'string' || !e.sessionId) return [];
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_REPORT_SECONDS) return [];
    return [{ videoId: e.videoId, sessionId: e.sessionId, seconds }];
  });
}

