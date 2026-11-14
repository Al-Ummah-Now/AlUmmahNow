/**
 * Play-session quality, tagged by delivery source (epic #687). One report per
 * player load, sent when the page is hidden or the player goes away:
 * startup (play request → first frame), rebuffers after the first frame,
 * watch time, time-weighted average and peak bitrate, rendition switches,
 * errors and whether R2 fell back to Bunny. Video.js events only.
 *
 * Live view (admin Delivery page, last 60 minutes and "now"): while the
 * session goes on, `heartbeat()` (every 30 s from the player, and at once at
 * the first frame, a fallback and the first error) sends `kind: 'heartbeat'`
 * with `live`, the deltas since the previous report; the final report carries
 * the last deltas. The daily rollup still counts only the final report.
 */
import type { MediaProviderId, PlaybackFallbackReason } from '@al-ummah/shared-types';
import type { DeviceClass } from './delivery';

export interface QoeReport {
  sessionId: string;
  source: MediaProviderId;
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
  /** Source the API chose for this play */
  requested: MediaProviderId;
  /** Source the session ended on (the next source after a fallback) */
  actual: MediaProviderId;
  /** Why the player left the requested source */
  fallbackReason?: PlaybackFallbackReason;
  kind?: 'final' | 'heartbeat';
  /** Source delivering the session now (the next source after a fallback) */
  serving?: MediaProviderId;
  playing?: boolean;
  live?: QoeLiveDelta;
}

/** What changed since the session's previous report (live view). */
export interface QoeLiveDelta {
  attempt?: boolean;
  started?: boolean;
  startupMs?: number;
  watchMs: number;
  rebufferMs: number;
  rebuffers: number;
  avgKbps?: number;
  errored?: boolean;
  fallback?: boolean;
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
  private source: MediaProviderId;
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
  private fallbackReason?: PlaybackFallbackReason;
  private seeking = false;
  private sent = false;
  private cursor = { watchMs: 0, kbpsMs: 0, rebufferMs: 0, rebuffers: 0 };
  private told = { attempt: false, started: false, errored: false, fallback: false };
  private lastPlaying = false;
  private readonly handlers: [string, () => void][];

  constructor(
    private player: QoePlayer,
    private readonly opts: {
      sessionId: string;
      source: MediaProviderId;
      device: DeviceClass;
      send: (r: QoeReport) => void;
      /** Live heartbeats (optional: without it the tracker sends only the final report) */
      beat?: (r: QoeReport) => void;
      now?: Clock;
    },
  ) {
    this.source = opts.source;
    const now = opts.now ?? (() => performance.now());
    this.handlers = [
      ['play', () => { if (this.playRequestedAt === undefined) this.playRequestedAt = now(); }],
      ['playing', () => {
        const t = now();
        let firstFrame = false;
        if (this.firstFrameAt === undefined) {
          this.firstFrameAt = t;
          if (this.playRequestedAt !== undefined) this.startupMs = Math.max(0, Math.round(t - this.playRequestedAt));
          firstFrame = true;
        }
        if (this.waitingSince !== undefined) {
          this.rebufferMs += t - this.waitingSince;
          this.waitingSince = undefined;
        }
        this.seeking = false;
        this.sampleBitrate();
        this.playingSince ??= t;
        // Plays started show in the live view at once
        if (firstFrame) this.heartbeat();
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
      ['error', () => {
        this.errors++;
        if (this.errors === 1) this.heartbeat();
      }],
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

  /**
   * The source failed and the player moved to `to` (the next in the API's list): the session now
   * plays from `to`, flagged as a fallback. The first reason is kept; the report counts against the
   * provider the API asked for.
   */
  markFallback(reason: PlaybackFallbackReason = 'other', to: MediaProviderId = 'bunny'): void {
    if (!this.fallback) this.fallbackReason = reason;
    this.fallback = true;
    this.source = to;
    this.lastKbps = undefined;
    this.heartbeat();
  }

  /** Deltas since the previous report (moves the cursor). */
  private liveDelta(r: QoeReport): QoeLiveDelta {
    const kbpsMs = this.kbpsMs;
    const d: QoeLiveDelta = {
      watchMs: Math.max(0, r.watchMs - this.cursor.watchMs),
      rebufferMs: Math.max(0, r.rebufferMs - this.cursor.rebufferMs),
      rebuffers: Math.max(0, r.rebuffers - this.cursor.rebuffers),
    };
    const dk = kbpsMs - this.cursor.kbpsMs;
    if (d.watchMs > 0 && dk > 0) d.avgKbps = Math.round(dk / d.watchMs);
    if (!this.told.attempt && this.playRequestedAt !== undefined) d.attempt = this.told.attempt = true;
    if (!this.told.started && r.started) {
      d.started = this.told.started = true;
      if (r.startupMs !== undefined) d.startupMs = r.startupMs;
    }
    if (!this.told.errored && r.errors > 0) d.errored = this.told.errored = true;
    if (!this.told.fallback && r.fallback) d.fallback = this.told.fallback = true;
    this.cursor = { watchMs: r.watchMs, kbpsMs, rebufferMs: r.rebufferMs, rebuffers: r.rebuffers };
    return d;
  }

  /**
   * Live heartbeat: the deltas since the last report, while the session goes
   * on. Nothing before play was asked for, after the final report, or when
   * nothing changed on a paused player.
   */
  heartbeat(): void {
    if (this.sent || this.playRequestedAt === undefined || !this.opts.beat) return;
    const r = this.report();
    const playing = !this.player.paused() && this.firstFrameAt !== undefined;
    const live = this.liveDelta(r);
    const changed = playing || playing !== this.lastPlaying || live.watchMs > 0 || live.rebufferMs > 0 || live.attempt || live.started || live.errored || live.fallback;
    this.lastPlaying = playing;
    if (!changed) return;
    this.opts.beat({ ...r, kind: 'heartbeat', serving: this.source, playing, live });
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
      // A fallback session counts against the source the API asked for (the one that failed it)
      source: this.fallback ? this.opts.source : this.source,
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
      requested: this.opts.source,
      actual: this.source,
      ...(this.fallbackReason ? { fallbackReason: this.fallbackReason } : {}),
    };
  }

  /** Send once (page hidden, player disposed). Sessions that never asked to play are not sent. */
  flush(): void {
    if (this.sent || this.playRequestedAt === undefined) return;
    this.sent = true;
    const r = this.report();
    this.opts.send(this.opts.beat ? { ...r, serving: this.source, live: this.liveDelta(r) } : r);
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
