/**
 * Live playback quality per delivery source (epic #687, docs/admin/LIVE_OPS.md):
 * the "last 60 minutes" and "now" views of the admin Delivery page.
 *
 * One object per environment, named `qoe-live` (same WebSocketDurableObject
 * class: releases cannot add classes). api-videos forwards each player
 * heartbeat's deltas here (POST /qoe/beats). They are summed in memory into
 * per-minute buckets per provider and written to this object's storage at
 * most every 5 s (never D1, never per beacon). Buckets are kept 48 h.
 *
 * Every flush also sends one `qoe` event on the admin:media live topic with the
 * current minute's buckets and the plays going on now (sessions whose last
 * heartbeat, at most 75 s old, said they were playing), counted per source
 * actually serving them.
 */

import type { AdminLiveEvent } from '@al-ummah/shared-types';

export type Provider = 'bunny' | 'r2';
export const PROVIDERS: readonly Provider[] = ['bunny', 'r2'];

/** Sums for one provider in one minute. Ratios are derived by the reader. */
export interface QoeBucket {
  /** Sessions that asked to play */
  attempts: number;
  /** Sessions whose first frame showed */
  plays: number;
  startupMsSum: number;
  watchMs: number;
  rebufferMs: number;
  rebuffers: number;
  /** Σ kbps × seconds watched */
  kbpsWatchS: number;
  /** Sessions with a playback error */
  errorSessions: number;
  /** R2 sessions that fell back to Bunny */
  fallbacks: number;
}

/** One heartbeat's deltas since the session's previous heartbeat. */
export interface QoeBeat {
  sessionId: string;
  /** Source the figures count against (an R2 session that fell back stays r2, as in the daily rollup) */
  source: Provider;
  /** Source delivering it now (bunny after a fallback): what "now" counts */
  serving: Provider;
  playing: boolean;
  /** The session ended (player closed, page left): no longer "now" */
  ended?: boolean;
  d: Partial<Record<'attempt' | 'started' | 'startupMs' | 'watchMs' | 'rebufferMs' | 'rebuffers' | 'kbpsWatchS' | 'errored' | 'fallback', number>>;
}

export interface QoeMinute {
  /** ISO minute, e.g. 2026-11-12T10:41 */
  minute: string;
  bunny: QoeBucket;
  r2: QoeBucket;
}

export interface QoeNow {
  bunny: number;
  r2: number;
}

export interface QoeStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(entries: Record<string, T>): Promise<void>;
  list<T>(options: { prefix?: string; start?: string; end?: string; limit?: number }): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<number>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export const FLUSH_MS = 5_000;
export const PLAYING_TTL_MS = 75_000;
export const RETENTION_MS = 48 * 3600_000;
const PRUNE_EVERY_MS = 3600_000;
const MARKER_KEY = 'qoe-live';
const MINUTE_PREFIX = 'm:';
const MAX_SESSIONS = 50_000;

export const emptyBucket = (): QoeBucket => ({ attempts: 0, plays: 0, startupMsSum: 0, watchMs: 0, rebufferMs: 0, rebuffers: 0, kbpsWatchS: 0, errorSessions: 0, fallbacks: 0 });

export function minuteOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

const clampNum = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, max) : 0);

/** Adds one beat's deltas to a bucket (bounded, so a bad client cannot skew a minute much). */
export function addBeat(bucket: QoeBucket, d: QoeBeat['d']): void {
  bucket.attempts += d.attempt ? 1 : 0;
  if (d.started) {
    bucket.plays += 1;
    bucket.startupMsSum += clampNum(d.startupMs, 120_000);
  }
  bucket.watchMs += clampNum(d.watchMs, 600_000);
  bucket.rebufferMs += clampNum(d.rebufferMs, 600_000);
  bucket.rebuffers += clampNum(d.rebuffers, 1_000);
  bucket.kbpsWatchS += clampNum(d.kbpsWatchS, 200_000 * 600);
  bucket.errorSessions += d.errored ? 1 : 0;
  bucket.fallbacks += d.fallback ? 1 : 0;
}

export function isBeat(v: unknown): v is QoeBeat {
  const b = v as QoeBeat;
  return (
    !!b && typeof b.sessionId === 'string' && b.sessionId.length >= 8 && b.sessionId.length <= 128 &&
    PROVIDERS.includes(b.source) && PROVIDERS.includes(b.serving) && typeof b.playing === 'boolean' &&
    !!b.d && typeof b.d === 'object'
  );
}

export class QoeLive {
  private minutes = new Map<string, QoeMinute>();
  private dirty = new Set<string>();
  private sessions = new Map<string, { serving: Provider; playing: boolean; seen: number }>();
  private lastNow: QoeNow = { bunny: 0, r2: 0 };
  private lastPrune = 0;
  private marked = false;

  constructor(
    private storage: QoeStorage,
    /** Sends the admin:media `qoe` event (through the topic's coalescer). */
    private publish: (event: AdminLiveEvent) => Promise<void>,
    private clock: () => number = Date.now,
  ) {}

  /** Takes a batch of heartbeats. Returns how many were valid. */
  async addBeats(beats: unknown[]): Promise<number> {
    const now = this.clock();
    const minute = minuteOf(now);
    const current = await this.minute(minute);
    let n = 0;
    for (const beat of beats) {
      if (!isBeat(beat)) continue;
      n++;
      addBeat(current[beat.source], beat.d);
      if (beat.ended) this.sessions.delete(beat.sessionId);
      else if (this.sessions.size < MAX_SESSIONS || this.sessions.has(beat.sessionId)) {
        this.sessions.set(beat.sessionId, { serving: beat.serving, playing: beat.playing, seen: now });
      }
    }
    if (n > 0) {
      this.dirty.add(minute);
      if (!this.marked) {
        await this.storage.put({ [MARKER_KEY]: true });
        this.marked = true;
      }
      if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(now + FLUSH_MS);
    }
    return n;
  }

  /** Plays going on now per serving source; forgets sessions silent for longer than PLAYING_TTL_MS. */
  now(): QoeNow {
    const cutoff = this.clock() - PLAYING_TTL_MS;
    const counts: QoeNow = { bunny: 0, r2: 0 };
    for (const [id, s] of this.sessions) {
      if (s.seen < cutoff) this.sessions.delete(id);
      else if (s.playing) counts[s.serving]++;
    }
    return counts;
  }

  /** The last `minutes` minutes (oldest first, empty minutes included) and the plays now. */
  async recent(minutes = 60): Promise<{ minutes: QoeMinute[]; now: QoeNow; at: string }> {
    const span = Math.max(1, Math.min(minutes, 48 * 60));
    const end = this.clock();
    const first = minuteOf(end - (span - 1) * 60_000);
    const stored = await this.storage.list<QoeMinute>({ prefix: MINUTE_PREFIX, start: `${MINUTE_PREFIX}${first}` });
    const out: QoeMinute[] = [];
    for (let i = span - 1; i >= 0; i--) {
      const m = minuteOf(end - i * 60_000);
      out.push(this.minutes.get(m) ?? stored.get(`${MINUTE_PREFIX}${m}`) ?? { minute: m, bunny: emptyBucket(), r2: emptyBucket() });
    }
    return { minutes: out, now: this.now(), at: new Date(end).toISOString() };
  }

  /**
   * Writes the touched minutes, sends one `qoe` event when anything changed,
   * prunes old minutes hourly, and keeps the alarm going while there is
   * something to expire. Returns false when this object is not the QoE object.
   */
  async alarm(): Promise<boolean> {
    if (!(await this.storage.get<boolean>(MARKER_KEY))) return false;
    const t = this.clock();
    const nowCounts = this.now();
    const changedNow = nowCounts.bunny !== this.lastNow.bunny || nowCounts.r2 !== this.lastNow.r2;
    const current = minuteOf(t);
    if (this.dirty.size > 0) {
      const entries: Record<string, QoeMinute> = {};
      for (const m of this.dirty) {
        const bucket = this.minutes.get(m);
        if (bucket) entries[`${MINUTE_PREFIX}${m}`] = bucket;
      }
      await this.storage.put(entries);
    }
    if (this.dirty.size > 0 || changedNow) {
      const minute = this.minutes.get(current) ?? { minute: current, bunny: emptyBucket(), r2: emptyBucket() };
      this.lastNow = nowCounts;
      this.dirty.clear();
      await this.publish({ kind: 'qoe', key: 'qoe', minute: minute.minute, bunny: minute.bunny, r2: minute.r2, now: nowCounts, at: new Date(t).toISOString() });
    }
    // Only the current and previous minute stay in memory
    for (const m of this.minutes.keys()) if (m < minuteOf(t - 60_000)) this.minutes.delete(m);
    if (t - this.lastPrune >= PRUNE_EVERY_MS) {
      this.lastPrune = t;
      await this.prune(t);
    }
    if (this.sessions.size > 0 || this.dirty.size > 0) await this.storage.setAlarm(t + FLUSH_MS);
    return true;
  }

  private async prune(t: number): Promise<void> {
    const old = await this.storage.list<QoeMinute>({ prefix: MINUTE_PREFIX, end: `${MINUTE_PREFIX}${minuteOf(t - RETENTION_MS)}`, limit: 1000 });
    if (old.size > 0) await this.storage.delete([...old.keys()].slice(0, 128));
  }

  private async minute(m: string): Promise<QoeMinute> {
    let bucket = this.minutes.get(m);
    if (!bucket) {
      // After an eviction the minute may already have stored sums
      bucket = (await this.storage.get<QoeMinute>(`${MINUTE_PREFIX}${m}`)) ?? { minute: m, bunny: emptyBucket(), r2: emptyBucket() };
      this.minutes.set(m, bucket);
    }
    return bucket;
  }
}
