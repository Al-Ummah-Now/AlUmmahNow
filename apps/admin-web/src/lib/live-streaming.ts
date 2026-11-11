/**
 * The Live streaming page's logic (pure, so it is unit tested): what a mode
 * choice sends, what Undo sends back, which changes need the confirm dialog,
 * the comparison table's rows and the charts' series. Changes apply to new
 * streams within 15 s (api-videos cache) and never cut a live session.
 */
import {
  LIVE_PROVIDERS,
  livePatchPrevious,
  otherLiveProvider,
  type LiveComparison,
  type LiveProviderId,
  type LiveProviderStats,
  type LiveRoutingMode,
  type LiveRoutingPatch,
  type LiveRoutingSettings,
} from '@al-ummah/shared-types';

export { LIVE_PROVIDERS, otherLiveProvider };

/** What the backend's settings cache needs before a change reaches new streams. */
export const LIVE_SETTINGS_CACHE_SECONDS = 15;

/** The split slider's steps (percent of new streams for Bunny). */
export const SPLIT_STEP = 5;

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value / SPLIT_STEP) * SPLIT_STEP));
}

/**
 * The patch a mode choice sends. Weighted mode carries the split (the slider's
 * value); the other modes leave the stored split alone, so going back to
 * Weighted restores it.
 */
export function modePatch(mode: LiveRoutingMode, bunnyPercent?: number): LiveRoutingPatch {
  return mode === 'weighted' && bunnyPercent !== undefined ? { mode, bunnyPercent: clampSplit(bunnyPercent) } : { mode };
}

/** "70/30" for Bunny/self-hosted. */
export function splitLabel(bunnyPercent: number): string {
  const b = clampSplit(bunnyPercent);
  return `${b}/${100 - b}`;
}

/** Undo for a settings change: the replaced values of exactly the fields it changed. */
export function undoPatchFor(before: LiveRoutingSettings, patch: LiveRoutingPatch): LiveRoutingPatch {
  return livePatchPrevious(before, patch);
}

/** Applies a patch locally (optimistic view; the server's answer replaces it). */
export function applyPatch(settings: LiveRoutingSettings, patch: LiveRoutingPatch): LiveRoutingSettings {
  const next: LiveRoutingSettings = {
    ...settings,
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
    ...(patch.bunnyPercent !== undefined ? { bunnyPercent: patch.bunnyPercent } : {}),
    ...(patch.fallback !== undefined ? { fallback: patch.fallback } : {}),
    ...(patch.qoeSampleRate !== undefined ? { qoeSampleRate: patch.qoeSampleRate } : {}),
    providers: { ...settings.providers },
    rates: { ...settings.rates },
    selfhosted: { ...settings.selfhosted, ...(patch.selfhosted ?? {}) },
  };
  for (const p of LIVE_PROVIDERS) {
    if (patch.providers?.[p]) next.providers[p] = { ...settings.providers[p], ...patch.providers[p] };
    if (patch.rates?.[p]) next.rates[p] = { ...settings.rates[p], ...patch.rates[p] };
  }
  return next;
}

/** Turning a provider off is the one settings change that asks first (in-app dialog); the rest act at once with Undo. */
export function needsConfirm(settings: LiveRoutingSettings, patch: LiveRoutingPatch): LiveProviderId | null {
  for (const p of LIVE_PROVIDERS) {
    if (patch.providers?.[p]?.enabled === false && settings.providers[p].enabled) return p;
  }
  return null;
}

/**
 * Reads an optional number field: '' means "no limit" (null), anything that is
 * not a non-negative number is refused (undefined).
 */
export function parseLimit(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Reads a required non-negative number (rates, timeouts); undefined when invalid. */
export function parseAmount(raw: string, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
}

/** A channel override's inverse: put back the provider it replaced, or remove it when there was none. */
export type OverrideUndo = { kind: 'set'; channelId: string; provider: LiveProviderId; note: string | null } | { kind: 'remove'; channelId: string };

export function overrideUndo(channelId: string, before: { provider: LiveProviderId; note: string | null } | null): OverrideUndo {
  return before ? { kind: 'set', channelId, provider: before.provider, note: before.note } : { kind: 'remove', channelId };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface LiveSessionItem {
  id: string;
  stream_id: string;
  channel_id: string | null;
  channel_name?: string | null;
  provider: LiveProviderId;
  status: 'provisioned' | 'live' | 'ended' | 'failed';
  reason: string;
  failover_from?: string | null;
  is_test?: number;
  created_at: number;
  first_segment_at?: number | null;
  last_segment_at?: number | null;
  ended_at?: number | null;
  end_reason?: string | null;
}

export const isActiveSession = (s: Pick<LiveSessionItem, 'status'>) => s.status === 'provisioned' || s.status === 'live';

/** Known reasons are translated; rerouted_* share one family label plus the cause. */
export const SESSION_REASONS = [
  'round_robin',
  'weighted',
  'only',
  'channel_override',
  'stream_move',
  'rerouted_disabled',
  'rerouted_draining',
  'rerouted_concurrency',
  'rerouted_budget',
  'rerouted_unavailable',
  'failover',
] as const;

/** Active sessions first (newest first), then the rest; one row per session id. */
export function mergeSessions(active: LiveSessionItem[], recent: LiveSessionItem[]): LiveSessionItem[] {
  const seen = new Set<string>();
  const out: LiveSessionItem[] = [];
  for (const s of [...active, ...recent].sort((a, b) => Number(isActiveSession(b)) - Number(isActiveSession(a)) || b.created_at - a.created_at)) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/**
 * A session that looks stuck: still provisioned/live but no segment for a
 * while (the encoder is gone and the idle timeout did not end it). "End" is
 * offered for every active session; this only marks the likely ones.
 */
export function isStuck(s: LiveSessionItem, now: number, idleTimeoutSec: number): boolean {
  if (!isActiveSession(s)) return false;
  const last = s.last_segment_at ?? s.first_segment_at ?? s.created_at;
  return now - last > Math.max(idleTimeoutSec * 2, 120) * 1000;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type MetricFormat = 'count' | 'hours' | 'ms' | 'ratio' | 'kbps' | 'perHour' | 'usd' | 'usdSmall';

export interface MetricRow {
  key: string;
  format: MetricFormat;
  value: (s: LiveProviderStats) => number | null;
  /** Lower is better (used to mark the better provider). */
  lowerIsBetter?: boolean;
}

export const COMPARISON_ROWS: readonly MetricRow[] = [
  { key: 'sessions', format: 'count', value: (s) => s.sessions },
  { key: 'failedSessions', format: 'count', value: (s) => s.failedSessions, lowerIsBetter: true },
  { key: 'failovers', format: 'count', value: (s) => s.failovers, lowerIsBetter: true },
  { key: 'streamHours', format: 'hours', value: (s) => s.streamHours },
  { key: 'viewerHours', format: 'hours', value: (s) => s.viewerHours },
  { key: 'startupP50', format: 'ms', value: (s) => s.startupMsP50, lowerIsBetter: true },
  { key: 'startupP95', format: 'ms', value: (s) => s.startupMsP95, lowerIsBetter: true },
  { key: 'latencyP50', format: 'ms', value: (s) => s.latencyMsP50, lowerIsBetter: true },
  { key: 'latencyP95', format: 'ms', value: (s) => s.latencyMsP95, lowerIsBetter: true },
  { key: 'rebufferRatio', format: 'ratio', value: (s) => s.rebufferRatio, lowerIsBetter: true },
  { key: 'bitrate', format: 'kbps', value: (s) => s.avgBitrateKbps },
  { key: 'switches', format: 'perHour', value: (s) => s.switchesPerViewerHour, lowerIsBetter: true },
  { key: 'droppedFrames', format: 'perHour', value: (s) => s.droppedFramesPerViewerHour, lowerIsBetter: true },
  { key: 'errors', format: 'perHour', value: (s) => s.errorsPerViewerHour, lowerIsBetter: true },
  { key: 'ingestConnectP50', format: 'ms', value: (s) => s.ingestConnectMsP50, lowerIsBetter: true },
  { key: 'firstSegmentP50', format: 'ms', value: (s) => s.firstSegmentMsP50, lowerIsBetter: true },
  { key: 'reconnects', format: 'count', value: (s) => s.reconnects, lowerIsBetter: true },
  { key: 'recoveryP50', format: 'ms', value: (s) => s.reconnectRecoveryMsP50, lowerIsBetter: true },
  { key: 'vodReadyP50', format: 'ms', value: (s) => s.vodReadyMsP50, lowerIsBetter: true },
  { key: 'estCost', format: 'usd', value: (s) => s.estCostUsd, lowerIsBetter: true },
  { key: 'costPerStreamHour', format: 'usdSmall', value: (s) => s.costPerStreamHourUsd, lowerIsBetter: true },
  { key: 'costPerViewerHour', format: 'usdSmall', value: (s) => s.costPerViewerHourUsd, lowerIsBetter: true },
];

export function statsFor(comparison: LiveComparison | null, provider: LiveProviderId): LiveProviderStats | null {
  return comparison?.providers.find((p) => p.provider === provider) ?? null;
}

/** The better provider on a row, or null when either is missing or they tie. */
export function betterOf(row: MetricRow, bunny: LiveProviderStats | null, selfhosted: LiveProviderStats | null): LiveProviderId | null {
  const a = bunny ? row.value(bunny) : null;
  const b = selfhosted ? row.value(selfhosted) : null;
  if (a === null || b === null || a === b || row.lowerIsBetter === undefined) return null;
  return (a < b) === row.lowerIsBetter ? 'bunny' : 'selfhosted';
}

export type ChartMetric = 'latency' | 'rebuffer' | 'costPerViewerHour';

export interface ChartSeries {
  provider: LiveProviderId;
  /** One value per day in `days` (null: no data that day). */
  values: (number | null)[];
}

/** Every day from `from` to `to` (YYYY-MM-DD), inclusive. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return out;
  for (let t = start; t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Daily series per provider for one chart; days without data are null (a gap, never a zero). */
export function chartSeries(comparison: LiveComparison | null, metric: ChartMetric): { days: string[]; series: ChartSeries[] } {
  if (!comparison) return { days: [], series: [] };
  const days = dayRange(comparison.from.slice(0, 10), comparison.to.slice(0, 10));
  const series = LIVE_PROVIDERS.map((provider) => ({
    provider,
    values: days.map((day) => {
      const row = comparison.days.find((d) => d.day === day && d.provider === provider);
      if (!row) return null;
      if (metric === 'latency') return row.latencyMsP50;
      if (metric === 'rebuffer') return row.rebufferRatio;
      return row.viewerHours > 0 ? row.estCostUsd / row.viewerHours : null;
    }),
  }));
  return { days, series };
}

/** The default comparison window: the last 30 days, ending today (UTC). */
export function defaultRange(now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));

// ---------------------------------------------------------------------------
// Formatting and history
// ---------------------------------------------------------------------------

/** A comparison value in the admin's locale ('—' when there is no data). */
export function metricFormatter(locale: string, format: MetricFormat): (value: number | null) => string {
  const loc = /^ar\b/.test(locale) ? 'ar-u-nu-arab' : locale;
  const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat(loc, o);
  const formatters: Record<MetricFormat, (v: number) => string> = {
    count: (v) => nf({ maximumFractionDigits: 0 }).format(v),
    hours: (v) => nf({ style: 'unit', unit: 'hour', unitDisplay: 'short', maximumFractionDigits: 1 }).format(v),
    ms: (v) => (v >= 1000 ? nf({ style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(v / 1000) : nf({ style: 'unit', unit: 'millisecond', unitDisplay: 'short', maximumFractionDigits: 0 }).format(v)),
    ratio: (v) => nf({ style: 'percent', maximumFractionDigits: 2 }).format(v),
    kbps: (v) => nf({ style: 'unit', unit: 'kilobit-per-second', unitDisplay: 'short', maximumFractionDigits: 0 }).format(v),
    perHour: (v) => nf({ maximumFractionDigits: 2 }).format(v),
    usd: (v) => nf({ style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v),
    usdSmall: (v) => nf({ style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v),
  };
  return (value) => (value === null || !Number.isFinite(value) ? '—' : formatters[format](value));
}

export interface ChangeLine {
  /** Dotted field path, e.g. providers.bunny.enabled. */
  field: string;
  value: unknown;
  previous: unknown;
}

/** One line per changed field of an audit row (details vs previous), for the History list. */
export function changeLines(details: Record<string, unknown> | null | undefined, previous: Record<string, unknown> | null | undefined): ChangeLine[] {
  const out: ChangeLine[] = [];
  const walk = (value: unknown, prev: unknown, path: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, prev && typeof prev === 'object' ? (prev as Record<string, unknown>)[k] : undefined, path ? `${path}.${k}` : k);
      return;
    }
    out.push({ field: path, value, previous: prev });
  };
  walk(details ?? {}, previous ?? {}, '');
  if (!out.length && previous) walk(Object.fromEntries(Object.keys(previous).map((k) => [k, null])), previous, '');
  return out;
}

/** 'content:live-override:ch_1' → { kind: 'live-override', id: 'ch_1' }. */
export function auditTarget(key: string): { kind: string; id: string } {
  const rest = key.startsWith('content:') ? key.slice('content:'.length) : key;
  const i = rest.indexOf(':');
  return i < 0 ? { kind: rest, id: '' } : { kind: rest.slice(0, i), id: rest.slice(i + 1) };
}
