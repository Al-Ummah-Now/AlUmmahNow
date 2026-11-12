/**
 * Play-session quality, tagged by delivery source (epic #687). One report per
 * player load, sent when the page is hidden or the player goes away:
 * startup (play request → first frame), rebuffers after the first frame,
 * watch time, time-weighted average and peak bitrate, rendition switches,
 * errors and whether R2 fell back to Bunny. Video.js events only.
 */
import type { DeviceClass } from './delivery';

export interface QoeReport {
  sessionId: string;
  source: 'bunny' | 'r2';
  device: DeviceClass;
  started: boolean;
  startupMs?: number;
  rebuffers: number;
  rebufferMs: number;
  watchMs: number;
  avgKbps?: number;
  peakKbps?: number;
  switches: number;
  errors: number;
  fallback: boolean;
}

/** The parts of a Video.js player the tracker uses. */
export interface QoePlayer {
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
  paused(): boolean;
  /** VHS's selected rendition bandwidth (bits/s), if known */
  bandwidth?(): number | undefined;
}

type Clock = () => number;

export class QoeTracker {
  private source: 'bunny' | 'r2';
  private playRequestedAt?: number;
  private firstFrameAt?: number;
  private startupMs?: number;
  private waitingSince?: number;
  private rebuffers = 0;
  private rebufferMs = 0;
  private playingSince?: number;
  private watchMs = 0;
  private kbpsMs = 0;
  private peakKbps = 0;
  private lastKbps?: number;
  private switches = 0;
  private errors = 0;
  private fallback = false;
  private seeking = false;
  private sent = false;
  private readonly handlers: [string, () => void][];

  constructor(
    private player: QoePlayer,
    private readonly opts: { sessionId: string; source: 'bunny' | 'r2'; device: DeviceClass; send: (r: QoeReport) => void; now?: Clock },
  ) {
    this.source = opts.source;
    const now = opts.now ?? (() => performance.now());
    this.handlers = [
      ['play', () => { if (this.playRequestedAt === undefined) this.playRequestedAt = now(); }],
      ['playing', () => {
        const t = now();
        if (this.firstFrameAt === undefined) {
          this.firstFrameAt = t;
          if (this.playRequestedAt !== undefined) this.startupMs = Math.max(0, Math.round(t - this.playRequestedAt));
        }
        if (this.waitingSince !== undefined) {
          this.rebufferMs += t - this.waitingSince;
          this.waitingSince = undefined;
        }
        this.seeking = false;
        this.sampleBitrate();
        this.playingSince ??= t;
      }],
      ['waiting', () => {
        const t = now();
        this.stopWatching(t);
        // Only stalls after the first frame are rebuffers (before it is startup; a seek's is the seek's)
        if (this.firstFrameAt !== undefined && this.waitingSince === undefined && !this.seeking) {
          this.rebuffers++;
          this.waitingSince = t;
        }
      }],
      ['pause', () => this.stopWatching(now())],
      ['ended', () => this.stopWatching(now())],
      ['seeking', () => {
        // A seek's buffering is not a rebuffer
        this.seeking = true;
        this.waitingSince = undefined;
      }],
      ['seeked', () => { this.seeking = false; }],
      ['error', () => { this.errors++; }],
      ['timeupdate', () => this.sampleBitrate()],
    ];
    for (const [e, fn] of this.handlers) player.on(e, fn);
    this.now = now;
  }

  private now: Clock;

  private stopWatching(t: number): void {
    if (this.playingSince === undefined) return;
    const dt = t - this.playingSince;
    this.watchMs += dt;
    if (this.lastKbps !== undefined) this.kbpsMs += this.lastKbps * dt;
    this.playingSince = undefined;
  }

  private sampleBitrate(): void {
    const bps = this.player.bandwidth?.();
    if (!bps || !Number.isFinite(bps)) return;
    const kbps = Math.round(bps / 1000);
    if (this.lastKbps !== undefined && kbps !== this.lastKbps) {
      // Close the time spent at the old bitrate
      if (this.playingSince !== undefined) {
        const t = this.now();
        this.kbpsMs += this.lastKbps * (t - this.playingSince);
        this.watchMs += t - this.playingSince;
        this.playingSince = t;
      }
      this.switches++;
    }
    this.lastKbps = kbps;
    this.peakKbps = Math.max(this.peakKbps, kbps);
  }

  /** R2 failed and the player switched to Bunny: the session is now Bunny's, flagged as a fallback. */
  markFallback(): void {
    this.fallback = true;
    this.source = 'bunny';
    this.lastKbps = undefined;
  }

  report(): QoeReport {
    const t = this.now();
    if (this.playingSince !== undefined) {
      const dt = t - this.playingSince;
      this.watchMs += dt;
      if (this.lastKbps !== undefined) this.kbpsMs += this.lastKbps * dt;
      this.playingSince = t;
    }
    const watchMs = Math.round(this.watchMs);
    return {
      sessionId: this.opts.sessionId,
      // A fallback session counts against R2 (the source that failed it)
      source: this.fallback ? 'r2' : this.source,
      device: this.opts.device,
      started: this.firstFrameAt !== undefined,
      ...(this.startupMs !== undefined ? { startupMs: Math.min(this.startupMs, 120_000) } : {}),
      rebuffers: this.rebuffers,
      rebufferMs: Math.round(this.rebufferMs + (this.waitingSince !== undefined ? t - this.waitingSince : 0)),
      watchMs,
      ...(watchMs > 0 && this.kbpsMs > 0 ? { avgKbps: Math.round(this.kbpsMs / watchMs) } : {}),
      ...(this.peakKbps ? { peakKbps: this.peakKbps } : {}),
      switches: this.switches,
      errors: this.errors,
      fallback: this.fallback,
    };
  }

  /** Send once (page hidden, player disposed). Sessions that never asked to play are not sent. */
  flush(): void {
    if (this.sent || this.playRequestedAt === undefined) return;
    this.sent = true;
    this.opts.send(this.report());
  }

  detach(): void {
    for (const [e, fn] of this.handlers) this.player.off(e, fn);
  }
}

/** Same-origin beacon (no CORS), forwarded to the API by /api/analytics/qoe. */
export function sendQoeBeacon(videoId: string, report: QoeReport): void {
  const body = JSON.stringify({ videoId, ...report });
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon?.('/api/analytics/qoe', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // fall through to fetch
  }
  void fetch('/api/analytics/qoe', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => undefined);
}
