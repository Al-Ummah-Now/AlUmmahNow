/**
 * The Delivery page's live playback view (docs/admin/LIVE_OPS.md): the last
 * 60 minutes per provider in 5-minute buckets, and the plays now. Pure, so it
 * is unit tested; server and client safe.
 */
import type { AdminLiveEvent } from '@al-ummah/shared-types';
import type { QoeLiveBucket, QoeLiveData, QoeLiveMinute } from '@/lib/api/types';

export const LIVE_WINDOW_MINUTES = 60;
export const BUCKET_MINUTES = 5;

export const emptyQoeBucket = (): QoeLiveBucket => ({ attempts: 0, plays: 0, startupMsSum: 0, watchMs: 0, rebufferMs: 0, rebuffers: 0, kbpsWatchS: 0, errorSessions: 0, fallbacks: 0 });

const KEYS = Object.keys(emptyQoeBucket()) as (keyof QoeLiveBucket)[];

function isBucket(v: unknown): v is QoeLiveBucket {
  return !!v && typeof v === 'object' && KEYS.every((k) => typeof (v as Record<string, unknown>)[k] === 'number');
}

function addMinutes(minute: string, n: number): string {
  return new Date(Date.parse(`${minute}:00Z`) + n * 60_000).toISOString().slice(0, 16);
}

/**
 * Applies an admin:media `qoe` event (realtime worker qoe-live.ts): the event's
 * minute replaces or extends the window, which keeps the last 60 minutes
 * ending at it, and "now" takes the event's counts. Other events: unchanged.
 */
export function applyQoeEvent(data: QoeLiveData | null, e: AdminLiveEvent): QoeLiveData | null {
  if (e.kind !== 'qoe' || e.truncated || typeof e.minute !== 'string' || !isBucket(e.bunny) || !isBucket(e.r2)) return data;
  const minute = e.minute;
  const byMinute = new Map((data?.minutes ?? []).map((m) => [m.minute, m]));
  byMinute.set(minute, { minute, bunny: e.bunny, r2: e.r2 });
  const latest = [...byMinute.keys()].sort().at(-1)!;
  const minutes: QoeLiveMinute[] = [];
  for (let i = LIVE_WINDOW_MINUTES - 1; i >= 0; i--) {
    const m = addMinutes(latest, -i);
    minutes.push(byMinute.get(m) ?? { minute: m, bunny: emptyQoeBucket(), r2: emptyQoeBucket() });
  }
  const now = e.now as { bunny?: unknown; r2?: unknown } | undefined;
  return {
    minutes,
    now: {
      bunny: typeof now?.bunny === 'number' ? now.bunny : data?.now.bunny ?? 0,
      r2: typeof now?.r2 === 'number' ? now.r2 : data?.now.r2 ?? 0,
    },
    at: typeof e.at === 'string' ? e.at : data?.at ?? new Date().toISOString(),
  };
}

function sum(buckets: QoeLiveBucket[]): QoeLiveBucket {
  const out = emptyQoeBucket();
  for (const b of buckets) for (const k of KEYS) out[k] += b[k];
  return out;
}

/** Groups minutes into 5-minute buckets (keyed by their first minute), oldest first. */
export function fiveMinuteBuckets(minutes: readonly QoeLiveMinute[]): QoeLiveMinute[] {
  const groups = new Map<string, QoeLiveMinute[]>();
  for (const m of minutes) {
    const mm = Number(m.minute.slice(14, 16));
    const key = `${m.minute.slice(0, 14)}${String(mm - (mm % BUCKET_MINUTES)).padStart(2, '0')}`;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([minute, list]) => ({ minute, bunny: sum(list.map((m) => m.bunny)), r2: sum(list.map((m) => m.r2)) }));
}

export type QoeMetric = 'plays' | 'startup' | 'rebuffer' | 'errorRate' | 'bitrate' | 'fallbacks';

/** A metric of a bucket; null where it has no meaning (no plays, nothing watched). */
export function qoeMetric(b: QoeLiveBucket, metric: QoeMetric): number | null {
  switch (metric) {
    case 'plays':
      return b.plays;
    case 'startup':
      return b.plays > 0 ? b.startupMsSum / b.plays / 1000 : null;
    case 'rebuffer':
      return b.watchMs + b.rebufferMs > 0 ? b.rebufferMs / (b.watchMs + b.rebufferMs) : null;
    case 'errorRate':
      return b.attempts > 0 ? Math.min(1, b.errorSessions / b.attempts) : null;
    case 'bitrate':
      return b.watchMs > 0 ? b.kbpsWatchS / (b.watchMs / 1000) : null;
    case 'fallbacks':
      return b.fallbacks;
  }
}

/** Totals of the whole window per provider (the strip under "now"). */
export function windowTotals(minutes: readonly QoeLiveMinute[]): { bunny: QoeLiveBucket; r2: QoeLiveBucket } {
  return { bunny: sum(minutes.map((m) => m.bunny)), r2: sum(minutes.map((m) => m.r2)) };
}
