'use client';

/**
 * Live QoE beacons (D3 provider comparison): a sampled share of viewers report
 * how the stream played, so Bunny Stream Live and self-hosted can be compared on
 * real viewers. Shape: LiveQoeBeacon (@al-ummah/shared-types). No user ids: the
 * viewer is a random key kept in memory for this page load.
 *
 * - Sampling: once per page load with probability state.qoe.sampleRate;
 *   `?liveqoe=1` forces it on (test harness) and exposes the running stats on
 *   `window.__liveQoe`.
 * - 'start' once at the first frame (startupMs), 'window' every
 *   LIVE_QOE_WINDOW_MS, 'end' on pagehide (navigator.sendBeacon) or when the
 *   player goes away.
 * - Glass-to-glass latency: server now − EXT-X-PROGRAM-DATE-TIME at the
 *   playhead. The server clock comes from the state response (serverNow, else
 *   its Date header) or, for self-hosted, the live host's /time.
 */
import { LIVE_QOE_WINDOW_MS, type LiveProviderId, type LiveQoeBeacon } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

let sampled: boolean | null = null;

/** Whether `?liveqoe=1` is on the page URL (forces sampling, exposes window.__liveQoe). */
export function qoeForced(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('liveqoe') === '1';
}

/** Decided once per page load: later calls return the first answer whatever the rate. */
export function isSampled(sampleRate: number, opts: { forced?: boolean; random?: () => number } = {}): boolean {
  if (sampled !== null) return sampled;
  const rate = Number.isFinite(sampleRate) ? Math.min(1, Math.max(0, sampleRate)) : 0;
  sampled = !!opts.forced || (rate > 0 && (opts.random ?? Math.random)() < rate);
  return sampled;
}

/** Tests only: forget this page load's sampling decision. */
export function resetSamplingForTests(): void {
  sampled = null;
}

/** Random per page load, never a user id. */
export function newViewerKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ---------------------------------------------------------------------------
// Clock and latency math (pure)
// ---------------------------------------------------------------------------

/**
 * Server clock − local clock (ms), assuming the server read its clock halfway
 * through the round trip. `serverNow` is exact (ms); a Date header has one
 * second resolution, so its midpoint (+500 ms) is used.
 */
export function clockOffset(timing: { sentAt: number; receivedAt: number; serverNow?: number | null; dateHeader?: string | null }): number | null {
  const mid = (timing.sentAt + timing.receivedAt) / 2;
  if (typeof timing.serverNow === 'number' && Number.isFinite(timing.serverNow)) return Math.round(timing.serverNow - mid);
  if (timing.dateHeader) {
    const parsed = Date.parse(timing.dateHeader);
    if (Number.isFinite(parsed)) return Math.round(parsed + 500 - mid);
  }
  return null;
}

/** A media playlist segment as VHS exposes it (only the fields used here). */
export interface SegmentLike {
  duration: number;
  /** EXT-X-PROGRAM-DATE-TIME of the segment's first frame. */
  dateTimeObject?: Date;
  /** Player timeline position of the segment, once VHS knows it. */
  start?: number;
}

/**
 * Program date-time (epoch ms) at player time `currentTime`, from the media
 * playlist's segments. Segment positions VHS has not filled in are counted from
 * the nearest known one; with none known, the last segment ends at the seekable
 * end (the live edge). Null when the playlist carries no PROGRAM-DATE-TIME.
 */
export function programTimeAt(segments: readonly SegmentLike[], currentTime: number, seekableEnd: number | null): number | null {
  if (!segments.length || !Number.isFinite(currentTime)) return null;
  const starts: (number | null)[] = segments.map((s) => (typeof s.start === 'number' && Number.isFinite(s.start) ? s.start : null));
  const anchor = starts.findIndex((s) => s !== null);
  if (anchor >= 0) {
    for (let i = anchor + 1; i < segments.length; i++) starts[i] ??= starts[i - 1]! + segments[i - 1].duration;
    for (let i = anchor - 1; i >= 0; i--) starts[i] ??= starts[i + 1]! - segments[i].duration;
  } else {
    if (seekableEnd === null || !Number.isFinite(seekableEnd)) return null;
    let end = seekableEnd;
    for (let i = segments.length - 1; i >= 0; i--) {
      starts[i] = end - segments[i].duration;
      end = starts[i]!;
    }
  }
  // The segment holding the playhead, else the nearest one before it
  let index = -1;
  for (let i = 0; i < segments.length; i++) if (starts[i]! <= currentTime) index = i;
  if (index < 0) index = 0;
  const date = segments[index].dateTimeObject;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  return date.getTime() + (currentTime - starts[index]!) * 1000;
}

/** Glass-to-glass latency (ms) from a program time and the corrected local clock. Null when implausible. */
export function latencyMs(programTime: number | null, localNow: number, offset: number | null): number | null {
  if (programTime === null) return null;
  const value = Math.round(localNow + (offset ?? 0) - programTime);
  return value >= 0 && value <= 600_000 ? value : null;
}

// ---------------------------------------------------------------------------
// The monitor
// ---------------------------------------------------------------------------

/** What the monitor reads from the player (video.js + VHS in the app; a fake in tests). */
export interface QoePlayerSource {
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
  currentTime(): number;
  paused(): boolean;
  seeking(): boolean;
  /** End of the seekable range (s), or null. */
  seekableEnd(): number | null;
  /** Live tracker's live edge (s), or null when not tracking. */
  liveEdge(): number | null;
  /** The active media playlist's segments (VHS), or null (native HLS). */
  segments(): SegmentLike[] | null;
  /** Native HLS (Safari): the program date-time of time 0, or null. */
  startDate(): number | null;
  /** The active rendition's id and bandwidth (bits/s), or null. */
  rendition(): { id: string; bandwidth: number | null } | null;
  /** Cumulative dropped video frames, or null. */
  droppedFrames(): number | null;
  /** The player's error code, or null. */
  errorCode(): string | null;
}

export interface QoeStats {
  streamId: string;
  sessionId: string;
  provider: LiveProviderId;
  sampled: boolean;
  viewerKey: string;
  clockOffsetMs: number | null;
  startupMs: number | null;
  firstFrameAt: number | null;
  /** Totals since attach. */
  total: { watchMs: number; rebufferCount: number; rebufferMs: number; renditionSwitches: number; droppedFrames: number; errors: number; latencyMs: number[] };
  /** The window being collected. */
  window: { latencyMs: number[]; rebufferCount: number; rebufferMs: number; watchMs: number; renditionSwitches: number; droppedFrames: number; errors: number };
  lastLatencyMs: number | null;
  liveEdgeSec: number | null;
  bitrateKbps: number | null;
  errorCode: string | null;
  sent: Array<LiveQoeBeacon['kind']>;
  ended: boolean;
}

export interface QoeMonitorOptions {
  streamId: string;
  sessionId: string;
  provider: LiveProviderId;
  beaconUrl: string;
  clockOffsetMs: number | null;
  /** When the player was attached or the viewer asked to play (startup start). */
  attachedAt?: number;
  /** Expose stats on window.__liveQoe (?liveqoe=1). */
  expose?: boolean;
  now?: () => number;
  send?: (url: string, beacon: LiveQoeBeacon) => void;
  /** Sample latency, bitrate and frames this often (ms). */
  tickMs?: number;
  windowMs?: number;
}

const MAX_LATENCY_SAMPLES = 120;

/** Sends a beacon without holding the page: sendBeacon (text/plain, no preflight), else a keepalive fetch. */
export function sendQoeBeacon(url: string, beacon: LiveQoeBeacon): void {
  const body = JSON.stringify(beacon);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
  } catch {
    // Falls through to fetch
  }
  void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch((error) =>
    logger.debug('[LiveQoe] Beacon not sent', { kind: beacon.kind, error: error instanceof Error ? error.message : String(error) }),
  );
}

export class LiveQoeMonitor {
  readonly stats: QoeStats;
  private readonly now: () => number;
  private readonly send: (url: string, beacon: LiveQoeBeacon) => void;
  private readonly attachedAt: number;
  private playIntentAt: number | null = null;
  private playingSince: number | null = null;
  private waitingSince: number | null = null;
  private lastRendition: string | null = null;
  private lastDropped: number | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly handlers: Array<[string, () => void]>;
  private readonly onPageHide = () => this.stop();

  constructor(private readonly player: QoePlayerSource, private readonly opts: QoeMonitorOptions) {
    this.now = opts.now ?? Date.now;
    this.send = opts.send ?? sendQoeBeacon;
    this.attachedAt = opts.attachedAt ?? this.now();
    this.stats = {
      streamId: opts.streamId,
      sessionId: opts.sessionId,
      provider: opts.provider,
      sampled: true,
      viewerKey: newViewerKey(),
      clockOffsetMs: opts.clockOffsetMs,
      startupMs: null,
      firstFrameAt: null,
      total: { watchMs: 0, rebufferCount: 0, rebufferMs: 0, renditionSwitches: 0, droppedFrames: 0, errors: 0, latencyMs: [] },
      window: emptyWindow(),
      lastLatencyMs: null,
      liveEdgeSec: null,
      bitrateKbps: null,
      errorCode: null,
      sent: [],
      ended: false,
    };
    this.handlers = [
      ['play', () => this.onPlay()],
      ['playing', () => this.onPlaying()],
      ['waiting', () => this.onWaiting()],
      ['pause', () => this.onStopped()],
      ['ended', () => this.onStopped()],
      ['error', () => this.onError()],
    ];
  }

  start(): this {
    for (const [event, fn] of this.handlers) this.player.on(event, fn);
    this.timers.push(setInterval(() => this.tick(), this.opts.tickMs ?? 5_000));
    this.timers.push(setInterval(() => this.flushWindow(), this.opts.windowMs ?? LIVE_QOE_WINDOW_MS));
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      if (this.opts.expose) (window as unknown as { __liveQoe?: QoeStats }).__liveQoe = this.stats;
    }
    // Already playing when attached (autoplay)
    if (!this.player.paused()) this.onPlaying();
    return this;
  }

  /** Sends 'end' (once) and detaches. */
  stop(): void {
    if (this.stats.ended) return;
    this.closeIntervals();
    if (this.stats.firstFrameAt !== null) this.emit('end');
    this.stats.ended = true;
    for (const [event, fn] of this.handlers) this.player.off(event, fn);
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
  }

  /** Reads latency, live edge, bitrate, switches and dropped frames now. */
  tick(): void {
    if (this.stats.ended) return;
    const rendition = this.player.rendition();
    if (rendition) {
      if (this.lastRendition !== null && rendition.id !== this.lastRendition) this.count('renditionSwitches', 1);
      this.lastRendition = rendition.id;
      this.stats.bitrateKbps = rendition.bandwidth ? Math.round(rendition.bandwidth / 1000) : this.stats.bitrateKbps;
    }
    const dropped = this.player.droppedFrames();
    if (dropped !== null) {
      if (this.lastDropped !== null && dropped > this.lastDropped) this.count('droppedFrames', dropped - this.lastDropped);
      this.lastDropped = dropped;
    }
    if (this.stats.firstFrameAt === null || this.player.paused()) return;
    const t = this.player.currentTime();
    const edge = this.player.liveEdge() ?? this.player.seekableEnd();
    this.stats.liveEdgeSec = edge !== null && Number.isFinite(edge) ? Math.max(0, Math.round((edge - t) * 10) / 10) : null;
    const segments = this.player.segments();
    const start = this.player.startDate();
    const program = segments ? programTimeAt(segments, t, this.player.seekableEnd()) : start !== null ? start + t * 1000 : null;
    const latency = latencyMs(program, this.now(), this.stats.clockOffsetMs);
    if (latency !== null) {
      this.stats.lastLatencyMs = latency;
      if (this.stats.window.latencyMs.length < MAX_LATENCY_SAMPLES) this.stats.window.latencyMs.push(latency);
      if (this.stats.total.latencyMs.length < MAX_LATENCY_SAMPLES) this.stats.total.latencyMs.push(latency);
    }
  }

  /** Sends the window collected so far and starts the next one. */
  flushWindow(): void {
    if (this.stats.ended || this.stats.firstFrameAt === null) return;
    this.closeIntervals();
    this.emit('window');
  }

  private onPlay(): void {
    if (this.stats.firstFrameAt === null && this.playIntentAt === null) this.playIntentAt = this.now();
  }

  private onPlaying(): void {
    const now = this.now();
    if (this.stats.firstFrameAt === null) {
      this.stats.firstFrameAt = now;
      // Startup counts from attach, or from the viewer's play when that came later (no autoplay)
      this.stats.startupMs = Math.max(0, now - Math.max(this.attachedAt, this.playIntentAt ?? this.attachedAt));
      this.emit('start');
    }
    if (this.waitingSince !== null) {
      this.count('rebufferMs', now - this.waitingSince);
      this.waitingSince = null;
    }
    this.playingSince ??= now;
  }

  private onWaiting(): void {
    // Before the first frame it is startup; a seek's wait is the viewer's own
    if (this.stats.firstFrameAt === null || this.player.seeking() || this.waitingSince !== null) return;
    this.closeWatch(this.now());
    this.waitingSince = this.now();
    this.count('rebufferCount', 1);
  }

  private onStopped(): void {
    const now = this.now();
    this.closeWatch(now);
    if (this.waitingSince !== null) {
      this.count('rebufferMs', now - this.waitingSince);
      this.waitingSince = null;
    }
  }

  private onError(): void {
    this.count('errors', 1);
    this.stats.errorCode = this.player.errorCode() ?? this.stats.errorCode;
  }

  /** Counts open watch and rebuffer time into the window up to now, keeping them open. */
  private closeIntervals(): void {
    const now = this.now();
    if (this.playingSince !== null) {
      this.count('watchMs', now - this.playingSince);
      this.playingSince = now;
    }
    if (this.waitingSince !== null) {
      this.count('rebufferMs', now - this.waitingSince);
      this.waitingSince = now;
    }
  }

  private closeWatch(now: number): void {
    if (this.playingSince === null) return;
    this.count('watchMs', now - this.playingSince);
    this.playingSince = null;
  }

  private count(key: 'watchMs' | 'rebufferCount' | 'rebufferMs' | 'renditionSwitches' | 'droppedFrames' | 'errors', value: number): void {
    if (value <= 0) return;
    this.stats.window[key] += value;
    this.stats.total[key] += value;
  }

  private emit(kind: LiveQoeBeacon['kind']): void {
    const w = this.stats.window;
    const beacon: LiveQoeBeacon = {
      streamId: this.stats.streamId,
      sessionId: this.stats.sessionId,
      provider: this.stats.provider,
      viewerKey: this.stats.viewerKey,
      kind,
      ...(kind === 'start' ? { startupMs: this.stats.startupMs } : {}),
      latencyMs: w.latencyMs.slice(0, MAX_LATENCY_SAMPLES),
      liveEdgeSec: this.stats.liveEdgeSec,
      rebufferCount: w.rebufferCount,
      rebufferMs: Math.round(w.rebufferMs),
      watchMs: Math.round(w.watchMs),
      bitrateKbps: this.stats.bitrateKbps,
      renditionSwitches: w.renditionSwitches,
      droppedFrames: w.droppedFrames,
      errors: w.errors,
      errorCode: this.stats.errorCode,
    };
    // 'start' carries only startup; the window's counters keep running into the first 'window'
    if (kind !== 'start') this.stats.window = emptyWindow();
    this.stats.sent.push(kind);
    try {
      this.send(this.opts.beaconUrl, kind === 'start' ? { ...beacon, latencyMs: [], rebufferCount: 0, rebufferMs: 0, watchMs: 0, renditionSwitches: 0, droppedFrames: 0, errors: 0 } : beacon);
    } catch (error) {
      logger.debug('[LiveQoe] Beacon failed', { kind, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function emptyWindow(): QoeStats['window'] {
  return { latencyMs: [], rebufferCount: 0, rebufferMs: 0, watchMs: 0, renditionSwitches: 0, droppedFrames: 0, errors: 0 };
}

// ---------------------------------------------------------------------------
// video.js + VHS adapter
// ---------------------------------------------------------------------------

interface VhsLike {
  playlists?: { media?: () => { id?: string; uri?: string; attributes?: { BANDWIDTH?: number }; segments?: SegmentLike[] } | undefined };
}

interface VideoJsLike {
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
  currentTime(): number;
  paused(): boolean;
  seeking(): boolean;
  seekable(): TimeRanges;
  error(): { code?: number } | null;
  liveTracker?: { isLive(): boolean; liveCurrentTime(): number };
  tech(opts: { IWillNotUseThisInPlugins: true }): { vhs?: VhsLike; el?: () => Element } | undefined;
  el(): Element | null;
}

/** Reads a video.js player (VHS or native HLS) for the monitor. */
export function videoJsSource(player: VideoJsLike): QoePlayerSource {
  const video = () => player.el()?.querySelector('video') as (HTMLVideoElement & { getStartDate?: () => Date }) | null;
  const media = () => player.tech({ IWillNotUseThisInPlugins: true })?.vhs?.playlists?.media?.();
  return {
    on: (event, fn) => player.on(event, fn),
    off: (event, fn) => player.off(event, fn),
    currentTime: () => player.currentTime() || 0,
    paused: () => player.paused(),
    seeking: () => player.seeking(),
    seekableEnd: () => {
      const ranges = player.seekable();
      return ranges && ranges.length ? ranges.end(ranges.length - 1) : null;
    },
    liveEdge: () => (player.liveTracker?.isLive() ? player.liveTracker.liveCurrentTime() : null),
    segments: () => media()?.segments ?? null,
    startDate: () => {
      const date = video()?.getStartDate?.();
      return date && Number.isFinite(date.getTime()) ? date.getTime() : null;
    },
    rendition: () => {
      const playlist = media();
      if (!playlist) return null;
      return { id: playlist.id ?? playlist.uri ?? '', bandwidth: playlist.attributes?.BANDWIDTH ?? null };
    },
    droppedFrames: () => video()?.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
    errorCode: () => {
      const code = player.error()?.code;
      return code ? `MEDIA_ERR_${code}` : null;
    },
  };
}

/** The live host's clock (self-hosted): offset from GET {playback origin}/time → { now }. */
export async function liveHostClockOffset(playbackUrl: string): Promise<number | null> {
  try {
    const origin = new URL(playbackUrl).origin;
    const sentAt = Date.now();
    const res = await fetch(`${origin}/time`, { cache: 'no-store' });
    const receivedAt = Date.now();
    if (!res.ok) return null;
    const body = (await res.json()) as { now?: number };
    return clockOffset({ sentAt, receivedAt, serverNow: body.now ?? null });
  } catch (error) {
    logger.debug('[LiveQoe] Live host clock not read', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
