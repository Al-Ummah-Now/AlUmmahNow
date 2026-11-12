/**
 * Delivery comparison arithmetic (epic #687, docs/media-delivery/R2-DELIVERY-PLAN.md
 * "Phase 3" and "Cost model"). Pure: no DOM, no React, no I/O.
 */
import type { MediaCostRow, MediaJobsSummary, MediaQoeRow } from '@/lib/api/types';
import type { MessageKey } from '@/i18n/translate';

export type Provider = 'bunny' | 'r2';
export const PROVIDERS: readonly Provider[] = ['bunny', 'r2'];

// ---------------------------------------------------------------------------
// Playback (QoE rollups)
// ---------------------------------------------------------------------------

type QoeSums = Omit<MediaQoeRow, 'day' | 'provider'>;
const QOE_FIELDS: (keyof QoeSums)[] = ['sessions', 'started', 'startup_ms_sum', 'rebuffers', 'rebuffer_ms', 'watch_ms', 'kbps_watch_s', 'peak_kbps_sum', 'switches', 'errors', 'fallbacks'];

export interface PlaybackStats {
  sessions: number;
  /** Average time to first frame, ms (null: no session started) */
  startupMs: number | null;
  /** Share of watch time spent rebuffering, 0..1 */
  rebufferRatio: number | null;
  /** Watch-time-weighted average bitrate, kbps */
  avgKbps: number | null;
  /** Average of each session's peak bitrate, kbps */
  peakKbps: number | null;
  switchesPerSession: number | null;
  errorRate: number | null;
  /** Plays that fell back from R2 to Bunny (r2 only) */
  fallbackRate: number | null;
  viewerHours: number;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

function emptySums(): QoeSums {
  return Object.fromEntries(QOE_FIELDS.map((f) => [f, 0])) as QoeSums;
}

function add(into: QoeSums, row: Partial<QoeSums>) {
  for (const f of QOE_FIELDS) into[f] += num(row[f]);
}

export function statsOf(s: QoeSums, provider: Provider): PlaybackStats {
  return {
    sessions: s.sessions,
    startupMs: ratio(s.startup_ms_sum, s.started),
    rebufferRatio: ratio(s.rebuffer_ms, s.watch_ms),
    avgKbps: ratio(s.kbps_watch_s, s.watch_ms / 1000),
    peakKbps: ratio(s.peak_kbps_sum, s.sessions),
    switchesPerSession: ratio(s.switches, s.sessions),
    errorRate: ratio(s.errors, s.sessions),
    fallbackRate: provider === 'r2' ? ratio(s.fallbacks, s.sessions) : null,
    viewerHours: s.watch_ms / 3_600_000,
  };
}

/** Totals over the period, per source. */
export function playbackTotals(rows: readonly MediaQoeRow[]): Record<Provider, PlaybackStats> {
  const sums: Record<Provider, QoeSums> = { bunny: emptySums(), r2: emptySums() };
  for (const row of rows) if (row.provider === 'bunny' || row.provider === 'r2') add(sums[row.provider], row);
  return { bunny: statsOf(sums.bunny, 'bunny'), r2: statsOf(sums.r2, 'r2') };
}

/** Every UTC day of the period, oldest first, ending today. */
export function periodDays(days: number, now = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export interface DailyPoint {
  day: string;
  /** Average startup, seconds (null: no started session that day) */
  startupS: number | null;
  /** Rebuffer ratio, 0..1 (null: nothing watched that day) */
  rebuffer: number | null;
}

/** Startup and rebuffer ratio per day and source; a day with no plays is null (a gap in the line). */
export function dailySeries(rows: readonly MediaQoeRow[], days: readonly string[]): Record<Provider, DailyPoint[]> {
  const byKey = new Map<string, QoeSums>();
  for (const row of rows) {
    const key = `${row.provider}|${row.day}`;
    const sums = byKey.get(key) ?? emptySums();
    add(sums, row);
    byKey.set(key, sums);
  }
  const series = (provider: Provider) =>
    days.map((day) => {
      const s = byKey.get(`${provider}|${day}`);
      const startup = s ? ratio(s.startup_ms_sum, s.started) : null;
      return { day, startupS: startup === null ? null : startup / 1000, rebuffer: s ? ratio(s.rebuffer_ms, s.watch_ms) : null };
    });
  return { bunny: series('bunny'), r2: series('r2') };
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/** List prices (2026-11) and the plan's assumptions until measured numbers replace them. */
export const PRICES = {
  /** Containers standard-4, per instance-second (CPU billed only while active: an upper bound) */
  containerSecond: 0.0001114,
  r2GbMonth: 0.015,
  r2ClassAPerMillion: 4.5,
  r2ClassBPerMillion: 0.36,
  r2EgressGb: 0,
  /** Per region; the library replicates to 2 */
  bunnyStorageGbMonthPerRegion: 0.01,
  bunnyRegions: 2,
  bunnyDeliveryGbLow: 0.005,
  bunnyDeliveryGbHigh: 0.01,
} as const;

export const ASSUMED = {
  /** standard-4 transcodes at about 0.75x real time */
  containerSecondsPerVideoMinute: 45,
  /** About 7 Mbps summed over the ladder, less with CRF: 40 MB per video-minute */
  storedGbPerVideoMinute: 0.04,
  /** R2 writes per video-minute (segments, playlists, manifest) */
  classAPerVideoMinute: 40,
  /** R2 reads per viewer-hour: ~720 segment requests at a 10% cache miss ratio */
  classBPerViewerHour: 72,
  /** About 2 Mbps */
  gbPerViewerHour: 0.9,
  /** Storage is shown after a year of uploads at the same rate */
  storageMonths: 12,
} as const;

export const MONTHLY_CAP_USD = 500;

export interface Scale {
  id: 'small' | 'medium' | 'large';
  uploadHours: number;
  viewerHours: number;
}

export const SCALES: readonly Scale[] = [
  { id: 'small', uploadHours: 20, viewerHours: 2_000 },
  { id: 'medium', uploadHours: 200, viewerHours: 50_000 },
  { id: 'large', uploadHours: 1_000, viewerHours: 500_000 },
];

export interface UnitCosts {
  containerSecondsPerVideoMinute: number;
  storedGbPerVideoMinute: number;
  classAPerVideoMinute: number;
  classBPerViewerHour: number;
  /** Bunny delivery GB per viewer-hour */
  gbPerViewerHour: number;
  /** Which of the above come from this environment's measurements */
  measured: { transcode: boolean; storage: boolean; classA: boolean; classB: boolean; delivery: boolean };
}

/**
 * Unit costs from the measured period where there is enough to divide by,
 * else the plan's assumptions. Cost metrics (delivery_cost_daily, written by
 * the collector): r2 class_a_ops / class_b_ops, bunny egress_gb.
 */
export function unitCosts(jobs: MediaJobsSummary | null, costs: readonly MediaCostRow[], playback: Record<Provider, PlaybackStats>): UnitCosts {
  const videoMinutes = num(jobs?.video_seconds) / 60;
  const containerSeconds = num(jobs?.container_seconds);
  const bytes = num(jobs?.bytes);
  const metric = (provider: Provider, name: string) => costs.filter((c) => c.provider === provider && c.metric === name).reduce((sum, c) => sum + num(c.value), 0);
  const classA = metric('r2', 'class_a_ops');
  const classB = metric('r2', 'class_b_ops');
  const bunnyGb = metric('bunny', 'egress_gb');
  const measured = {
    transcode: videoMinutes > 0 && containerSeconds > 0,
    storage: videoMinutes > 0 && bytes > 0,
    classA: videoMinutes > 0 && classA > 0,
    classB: playback.r2.viewerHours > 0 && classB > 0,
    delivery: playback.bunny.viewerHours > 0 && bunnyGb > 0,
  };
  return {
    containerSecondsPerVideoMinute: measured.transcode ? containerSeconds / videoMinutes : ASSUMED.containerSecondsPerVideoMinute,
    storedGbPerVideoMinute: measured.storage ? bytes / 1e9 / videoMinutes : ASSUMED.storedGbPerVideoMinute,
    classAPerVideoMinute: measured.classA ? classA / videoMinutes : ASSUMED.classAPerVideoMinute,
    classBPerViewerHour: measured.classB ? classB / playback.r2.viewerHours : ASSUMED.classBPerViewerHour,
    gbPerViewerHour: measured.delivery ? bunnyGb / playback.bunny.viewerHours : ASSUMED.gbPerViewerHour,
    measured,
  };
}

export interface Projection {
  scale: Scale;
  r2: { transcode: number; storage: number; ops: number; total: number };
  bunny: { storage: number; deliveryLow: number; deliveryHigh: number; totalLow: number; totalHigh: number };
  /** Both sources during the dual-write trial */
  both: { low: number; high: number };
  fits: { r2: boolean; bunny: boolean; both: boolean };
}

/** Monthly cost of one scale, US dollars. Storage is the month after `ASSUMED.storageMonths` of uploads. */
export function projectMonthlyCost(scale: Scale, unit: UnitCosts, cap = MONTHLY_CAP_USD): Projection {
  const videoMinutes = scale.uploadHours * 60;
  const storedGb = videoMinutes * unit.storedGbPerVideoMinute * ASSUMED.storageMonths;
  const transcode = videoMinutes * unit.containerSecondsPerVideoMinute * PRICES.containerSecond;
  const r2Storage = storedGb * PRICES.r2GbMonth;
  const ops =
    (videoMinutes * unit.classAPerVideoMinute * PRICES.r2ClassAPerMillion + scale.viewerHours * unit.classBPerViewerHour * PRICES.r2ClassBPerMillion) / 1e6 +
    scale.viewerHours * unit.gbPerViewerHour * PRICES.r2EgressGb;
  const r2Total = transcode + r2Storage + ops;
  const bunnyStorage = storedGb * PRICES.bunnyStorageGbMonthPerRegion * PRICES.bunnyRegions;
  const deliveredGb = scale.viewerHours * unit.gbPerViewerHour;
  const deliveryLow = deliveredGb * PRICES.bunnyDeliveryGbLow;
  const deliveryHigh = deliveredGb * PRICES.bunnyDeliveryGbHigh;
  const bunny = { storage: bunnyStorage, deliveryLow, deliveryHigh, totalLow: bunnyStorage + deliveryLow, totalHigh: bunnyStorage + deliveryHigh };
  const both = { low: r2Total + bunny.totalLow, high: r2Total + bunny.totalHigh };
  return {
    scale,
    r2: { transcode, storage: r2Storage, ops, total: r2Total },
    bunny,
    both,
    fits: { r2: r2Total <= cap, bunny: bunny.totalHigh <= cap, both: both.high <= cap },
  };
}

/** Container seconds per video-minute and the transcode cost per video-minute, measured. */
export function transcodeCost(jobs: MediaJobsSummary | null): { containerSeconds: number; perVideoMinute: number | null; usdPerVideoMinute: number | null; storedGb: number } {
  const videoMinutes = num(jobs?.video_seconds) / 60;
  const containerSeconds = num(jobs?.container_seconds);
  const perVideoMinute = videoMinutes > 0 && containerSeconds > 0 ? containerSeconds / videoMinutes : null;
  return {
    containerSeconds,
    perVideoMinute,
    usdPerVideoMinute: perVideoMinute === null ? null : perVideoMinute * PRICES.containerSecond,
    storedGb: num(jobs?.bytes) / 1e9,
  };
}

/** Seconds from queued to ready for a job row (null until ready). */
export function jobSeconds(job: { queued_at: string; ready_at?: string | null }): number | null {
  if (!job.ready_at) return null;
  const s = (Date.parse(job.ready_at) - Date.parse(job.queued_at)) / 1000;
  return Number.isFinite(s) && s >= 0 ? s : null;
}

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(value: unknown): Period {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

export const JOB_FILTERS = ['all', 'failed', 'queued', 'transcoding', 'ready'] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

export function parseJobFilter(value: unknown): JobFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (JOB_FILTERS as readonly string[]).includes(v as string) ? (v as JobFilter) : 'all';
}

export const JOB_STATUS_LABEL: Record<string, MessageKey> = {
  queued: 'mediaDelivery.statusQueued',
  transcoding: 'mediaDelivery.statusTranscoding',
  ready: 'mediaDelivery.statusReady',
  failed: 'mediaDelivery.statusFailed',
};
