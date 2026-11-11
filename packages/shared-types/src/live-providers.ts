/**
 * Live providers (D3, decided 2026-11-11: both in production, round-robin,
 * decide on data). docs/research/live-2026-11/REPORT.md.
 *
 * Every new live stream is assigned one provider by the videos admin's
 * "Live streaming" settings (per environment): round-robin by default, a
 * weighted split, or one provider only; a provider can be disabled or
 * drained; a channel can be forced to one provider; caps (concurrent streams,
 * monthly budget) send new streams to the other provider. Changes apply to new
 * streams only and never cut a stream that is live.
 *
 * Creators and viewers see the same pages whichever provider serves them; the
 * provider is recorded on the stream and on every analytics row so the two can
 * be compared on real traffic.
 */

export const LIVE_PROVIDERS = ['bunny', 'selfhosted'] as const;
export type LiveProviderId = (typeof LIVE_PROVIDERS)[number];

export const isLiveProvider = (v: unknown): v is LiveProviderId => typeof v === 'string' && (LIVE_PROVIDERS as readonly string[]).includes(v);
export const otherLiveProvider = (p: LiveProviderId): LiveProviderId => (p === 'bunny' ? 'selfhosted' : 'bunny');

export const LIVE_ROUTING_MODES = ['round_robin', 'weighted', 'only_bunny', 'only_selfhosted'] as const;
export type LiveRoutingMode = (typeof LIVE_ROUTING_MODES)[number];

export interface LiveProviderControls {
  /** Off: never assigned, never used as a fallback. Streams already live keep running. */
  enabled: boolean;
  /** Draining: no new streams; streams already assigned finish normally. */
  draining: boolean;
  /** Why it is off or draining (shown on the admin page). */
  note: string | null;
  /** Concurrent live sessions allowed; null = no limit. */
  maxConcurrent: number | null;
  /** Estimated spend this calendar month (USD) at which new streams go elsewhere; null = no cap. */
  monthlyBudgetUsd: number | null;
}

/** List prices used to estimate cost units (USD); admins can correct them. */
export interface LiveProviderRates {
  /** Per streamed hour (transcode/ingest/storage while live). */
  perStreamHourUsd: number;
  /** Per GB delivered to viewers. */
  perDeliveredGbUsd: number;
  /** Per million requests at the edge (Workers requests for self-hosted). */
  perMillionRequestsUsd: number;
  /** Per GB-month stored for recordings. */
  perStoredGbMonthUsd: number;
}

export interface LiveSelfHostedOptions {
  /** 1 s segments and a 3-segment playlist instead of 2 s / 6. */
  lowLatency: boolean;
  /** End a session after this many seconds without a segment (encoder gone). */
  idleTimeoutSec: number;
  /** Keep the segments and publish a VOD playlist when the session ends. */
  recordVod: boolean;
}

export interface LiveRoutingSettings {
  mode: LiveRoutingMode;
  /** Weighted mode: percent of new streams for Bunny (the rest go self-hosted). */
  bunnyPercent: number;
  /** When a provider fails to create or start a stream, use the other one (recorded). */
  fallback: boolean;
  providers: Record<LiveProviderId, LiveProviderControls>;
  rates: Record<LiveProviderId, LiveProviderRates>;
  selfhosted: LiveSelfHostedOptions;
  /** Share of viewers whose players send QoE beacons (0–1). */
  qoeSampleRate: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_LIVE_PROVIDER_CONTROLS: LiveProviderControls = {
  enabled: true,
  draining: false,
  note: null,
  maxConcurrent: null,
  monthlyBudgetUsd: null,
};

/**
 * List prices on 2026-11-11 (REPORT.md §Cost): Bunny Stream delivery from the
 * volume tier, Bunny live transcoding while in preview is unpriced (0, corrected
 * by the admin once billed); self-hosted = Workers requests + R2 storage, $0 egress.
 */
export const DEFAULT_LIVE_RATES: Record<LiveProviderId, LiveProviderRates> = {
  bunny: { perStreamHourUsd: 0, perDeliveredGbUsd: 0.005, perMillionRequestsUsd: 0, perStoredGbMonthUsd: 0.01 },
  selfhosted: { perStreamHourUsd: 0, perDeliveredGbUsd: 0, perMillionRequestsUsd: 0.3, perStoredGbMonthUsd: 0.015 },
};

export const DEFAULT_LIVE_ROUTING: LiveRoutingSettings = {
  mode: 'round_robin',
  bunnyPercent: 50,
  fallback: true,
  providers: { bunny: { ...DEFAULT_LIVE_PROVIDER_CONTROLS }, selfhosted: { ...DEFAULT_LIVE_PROVIDER_CONTROLS } },
  rates: { bunny: { ...DEFAULT_LIVE_RATES.bunny }, selfhosted: { ...DEFAULT_LIVE_RATES.selfhosted } },
  selfhosted: { lowLatency: false, idleTimeoutSec: 60, recordVod: true },
  qoeSampleRate: 0.2,
  updatedAt: null,
  updatedBy: null,
};

/** A channel forced to one provider (admin override). */
export interface LiveChannelOverride {
  channelId: string;
  channelName?: string | null;
  provider: LiveProviderId;
  note: string | null;
  updatedBy: string;
  updatedAt: string;
}

/** Load the assignment needs, per provider. */
export interface LiveProviderUsage {
  /** Sessions live (or starting) now. */
  active: number;
  /** Estimated spend this calendar month (USD). */
  monthSpendUsd: number;
  /** Adapter configured in this environment (keys present, preview access granted). */
  available: boolean;
}

/** Why a stream got its provider (stored on the stream and the session). */
export type LiveAssignmentReason =
  | 'round_robin'
  | 'weighted'
  | 'only'
  | 'channel_override'
  | 'stream_move'
  | 'rerouted_disabled'
  | 'rerouted_draining'
  | 'rerouted_concurrency'
  | 'rerouted_budget'
  | 'rerouted_unavailable'
  | 'failover';

export interface LiveAssignment {
  provider: LiveProviderId;
  reason: LiveAssignmentReason;
  /** The provider the rules picked first, when it was rerouted. */
  preferred: LiveProviderId;
  /** Round-robin sequence number used (weighted/round-robin modes). */
  seq: number | null;
  at: string;
  /** Set when a create/start failure moved the stream: the provider that failed and its error code. */
  failover?: { from: LiveProviderId; error: string } | null;
}

/** Refusal when no provider may take a new stream. */
export type LiveRefusalCode = 'live_unavailable' | 'live_capacity' | 'live_budget';

/** What a creator's encoder needs; the same shape for both providers. */
export interface LiveIngest {
  /** 'rtmp' (Bunny) or 'https-hls' (self-hosted HLS push). */
  protocol: 'rtmp' | 'srt' | 'https-hls';
  /** Server URL to paste in the encoder. */
  url: string;
  /** Stream key (owner only). */
  streamKey: string;
  /** A ready ffmpeg command for this ingest (owner only, contains the key). */
  ffmpegExample: string;
}

export const LIVE_SESSION_STATUSES = ['provisioned', 'live', 'ended', 'failed'] as const;
export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number];

/** Owner/Studio view of a stream's live state (polled by the Go live page). */
export interface LiveStreamState {
  streamId: string;
  sessionId: string | null;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  sessionStatus: LiveSessionStatus | null;
  /** Encoder is sending (a segment / bitrate seen in the last 15 s). */
  receiving: boolean;
  playbackUrl: string | null;
  vodUrl: string | null;
  startedAt: string | null;
  endedAt: string | null;
  bitrateKbps: number | null;
}

// ---------------------------------------------------------------------------
// QoE beacons (player side). Sampled per viewer (settings.qoeSampleRate); one
// beacon per window (30 s) and one at the end. The server rejects oversized or
// unknown fields; never carries user ids or IPs.
// ---------------------------------------------------------------------------

export const LIVE_QOE_WINDOW_MS = 30_000;

export interface LiveQoeBeacon {
  streamId: string;
  sessionId: string;
  provider: LiveProviderId;
  /** Random per page load (not a user id). */
  viewerKey: string;
  /** 'start' (first frame), 'window' (periodic) or 'end'. */
  kind: 'start' | 'window' | 'end';
  /** Click/attach → first frame (ms); 'start' only. */
  startupMs?: number | null;
  /** Glass-to-glass estimate: now − EXT-X-PROGRAM-DATE-TIME at the playhead (ms), samples in this window. */
  latencyMs?: number[];
  /** Live-edge distance reported by the player (s). */
  liveEdgeSec?: number | null;
  rebufferCount?: number;
  rebufferMs?: number;
  /** Watched time in this window (ms). */
  watchMs?: number;
  bitrateKbps?: number | null;
  renditionSwitches?: number;
  droppedFrames?: number;
  errors?: number;
  /** Fatal player error code, if any. */
  errorCode?: string | null;
  /** Rough client region for the comparison (from the edge, filled by the server). */
  colo?: string | null;
}

/** Per-provider comparison row (admin dashboard). */
export interface LiveProviderStats {
  provider: LiveProviderId;
  sessions: number;
  failedSessions: number;
  failovers: number;
  streamHours: number;
  viewerHours: number;
  peakViewers: number;
  startupMsP50: number | null;
  startupMsP95: number | null;
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  /** Rebuffer time / watch time (0–1). */
  rebufferRatio: number | null;
  rebuffersPerViewerHour: number | null;
  avgBitrateKbps: number | null;
  switchesPerViewerHour: number | null;
  droppedFramesPerViewerHour: number | null;
  errorsPerViewerHour: number | null;
  ingestConnectMsP50: number | null;
  firstSegmentMsP50: number | null;
  reconnects: number;
  reconnectRecoveryMsP50: number | null;
  vodReadyMsP50: number | null;
  /** Estimated from cost units × the configured rates. */
  estCostUsd: number;
  costPerStreamHourUsd: number | null;
  costPerViewerHourUsd: number | null;
  /** Cost units behind the estimate. */
  units: { deliveredGb: number; edgeRequests: number; storedGb: number; ingestGb: number };
  qoeSamples: number;
}

export interface LiveComparisonDay {
  day: string;
  provider: LiveProviderId;
  sessions: number;
  viewerHours: number;
  latencyMsP50: number | null;
  rebufferRatio: number | null;
  estCostUsd: number;
}

export interface LiveComparison {
  from: string;
  to: string;
  providers: LiveProviderStats[];
  days: LiveComparisonDay[];
}

// ---------------------------------------------------------------------------
// Assignment (pure; shared by api-videos and the admin preview).
// ---------------------------------------------------------------------------

export interface LiveAssignInput {
  settings: Pick<LiveRoutingSettings, 'mode' | 'bunnyPercent' | 'providers'>;
  usage: Record<LiveProviderId, LiveProviderUsage>;
  /** Admin override for the stream's channel. */
  channelOverride?: LiveProviderId | null;
  /** Admin "move the next session to the other provider" for this stream. */
  streamMove?: LiveProviderId | null;
  /** Round-robin sequence for this assignment (from the shared counter). */
  seq: number;
  now?: string;
}

export type LiveAssignResult =
  | { ok: true; assignment: LiveAssignment }
  | { ok: false; code: LiveRefusalCode; reasons: Record<LiveProviderId, LiveIneligibility | null> };

export type LiveIneligibility = 'disabled' | 'draining' | 'concurrency' | 'budget' | 'unavailable';

/** Why a provider may not take a new stream now (null = it may). */
export function liveIneligibility(
  controls: LiveProviderControls,
  usage: LiveProviderUsage,
): LiveIneligibility | null {
  if (!controls.enabled) return 'disabled';
  if (!usage.available) return 'unavailable';
  if (controls.draining) return 'draining';
  if (controls.maxConcurrent != null && usage.active >= controls.maxConcurrent) return 'concurrency';
  if (controls.monthlyBudgetUsd != null && usage.monthSpendUsd >= controls.monthlyBudgetUsd) return 'budget';
  return null;
}

/**
 * Deterministic weighted split over the sequence: stream `seq` goes to Bunny
 * when the running count of Bunny picks steps up, so any run of 100 streams has
 * exactly `bunnyPercent` Bunny ones (50 = strict alternation).
 */
export function weightedPick(seq: number, bunnyPercent: number): LiveProviderId {
  const pct = Math.min(100, Math.max(0, Math.round(bunnyPercent)));
  const n = Math.max(0, Math.floor(seq));
  return Math.floor(((n + 1) * pct) / 100) > Math.floor((n * pct) / 100) ? 'bunny' : 'selfhosted';
}

const REROUTE: Record<LiveIneligibility, LiveAssignmentReason> = {
  disabled: 'rerouted_disabled',
  draining: 'rerouted_draining',
  concurrency: 'rerouted_concurrency',
  budget: 'rerouted_budget',
  unavailable: 'rerouted_unavailable',
};

/**
 * Picks the provider for a new stream (or a stream's next session).
 * Priority: the stream's move → the channel override → the mode. A picked
 * provider that may not take streams now (off, draining, at a cap, not
 * configured) hands the stream to the other one when that one may; otherwise
 * the stream is refused with the clearest code (budget, capacity, unavailable).
 */
export function assignLiveProvider(input: LiveAssignInput): LiveAssignResult {
  const { settings, usage } = input;
  const at = input.now ?? new Date().toISOString();
  let preferred: LiveProviderId;
  let reason: LiveAssignmentReason;
  let seq: number | null = null;
  if (input.streamMove) {
    preferred = input.streamMove;
    reason = 'stream_move';
  } else if (input.channelOverride) {
    preferred = input.channelOverride;
    reason = 'channel_override';
  } else if (settings.mode === 'only_bunny' || settings.mode === 'only_selfhosted') {
    preferred = settings.mode === 'only_bunny' ? 'bunny' : 'selfhosted';
    reason = 'only';
  } else {
    seq = input.seq;
    preferred = weightedPick(input.seq, settings.mode === 'round_robin' ? 50 : settings.bunnyPercent);
    reason = settings.mode === 'round_robin' ? 'round_robin' : 'weighted';
  }
  const why: Record<LiveProviderId, LiveIneligibility | null> = {
    bunny: liveIneligibility(settings.providers.bunny, usage.bunny),
    selfhosted: liveIneligibility(settings.providers.selfhosted, usage.selfhosted),
  };
  if (!why[preferred]) return { ok: true, assignment: { provider: preferred, reason, preferred, seq, at, failover: null } };
  const other = otherLiveProvider(preferred);
  if (!why[other]) return { ok: true, assignment: { provider: other, reason: REROUTE[why[preferred]!], preferred, seq, at, failover: null } };
  const codes = Object.values(why);
  const code: LiveRefusalCode = codes.includes('budget') && codes.every((c) => c === 'budget' || c === 'disabled')
    ? 'live_budget'
    : codes.some((c) => c === 'concurrency' || c === 'budget')
      ? 'live_capacity'
      : 'live_unavailable';
  return { ok: false, code, reasons: why };
}

/** Validates and fills an admin settings document (unknown fields dropped, numbers clamped). */
export function normaliseLiveRouting(input: unknown, base: LiveRoutingSettings = DEFAULT_LIVE_ROUTING): LiveRoutingSettings {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<LiveRoutingSettings> & Record<string, unknown>;
  const num = (v: unknown, d: number, min: number, max: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
    return Math.min(max, Math.max(min, n));
  };
  const optNum = (v: unknown, d: number | null, min: number, max: number) =>
    v === null ? null : v === undefined ? d : num(v, d ?? min, min, max);
  const note = (v: unknown, d: string | null) => (v === null ? null : typeof v === 'string' ? v.trim().slice(0, 500) || null : d);
  const controls = (v: unknown, d: LiveProviderControls): LiveProviderControls => {
    const c = (v && typeof v === 'object' ? v : {}) as Partial<LiveProviderControls>;
    return {
      enabled: typeof c.enabled === 'boolean' ? c.enabled : d.enabled,
      draining: typeof c.draining === 'boolean' ? c.draining : d.draining,
      note: note(c.note, d.note),
      maxConcurrent: optNum(c.maxConcurrent, d.maxConcurrent, 0, 10_000),
      monthlyBudgetUsd: optNum(c.monthlyBudgetUsd, d.monthlyBudgetUsd, 0, 1_000_000),
    };
  };
  const rates = (v: unknown, d: LiveProviderRates): LiveProviderRates => {
    const r = (v && typeof v === 'object' ? v : {}) as Partial<LiveProviderRates>;
    return {
      perStreamHourUsd: num(r.perStreamHourUsd, d.perStreamHourUsd, 0, 1000),
      perDeliveredGbUsd: num(r.perDeliveredGbUsd, d.perDeliveredGbUsd, 0, 10),
      perMillionRequestsUsd: num(r.perMillionRequestsUsd, d.perMillionRequestsUsd, 0, 100),
      perStoredGbMonthUsd: num(r.perStoredGbMonthUsd, d.perStoredGbMonthUsd, 0, 10),
    };
  };
  const p = (src.providers ?? {}) as Partial<Record<LiveProviderId, unknown>>;
  const rt = (src.rates ?? {}) as Partial<Record<LiveProviderId, unknown>>;
  const sh = (src.selfhosted ?? {}) as Partial<LiveSelfHostedOptions>;
  return {
    mode: (LIVE_ROUTING_MODES as readonly string[]).includes(src.mode as string) ? (src.mode as LiveRoutingMode) : base.mode,
    bunnyPercent: Math.round(num(src.bunnyPercent, base.bunnyPercent, 0, 100)),
    fallback: typeof src.fallback === 'boolean' ? src.fallback : base.fallback,
    providers: { bunny: controls(p.bunny, base.providers.bunny), selfhosted: controls(p.selfhosted, base.providers.selfhosted) },
    rates: { bunny: rates(rt.bunny, base.rates.bunny), selfhosted: rates(rt.selfhosted, base.rates.selfhosted) },
    selfhosted: {
      lowLatency: typeof sh.lowLatency === 'boolean' ? sh.lowLatency : base.selfhosted.lowLatency,
      idleTimeoutSec: Math.round(num(sh.idleTimeoutSec, base.selfhosted.idleTimeoutSec, 15, 900)),
      recordVod: typeof sh.recordVod === 'boolean' ? sh.recordVod : base.selfhosted.recordVod,
    },
    qoeSampleRate: num(src.qoeSampleRate, base.qoeSampleRate, 0, 1),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : base.updatedAt,
    updatedBy: typeof src.updatedBy === 'string' ? src.updatedBy : base.updatedBy,
  };
}

/** p-th percentile (0–100) of numbers, nearest-rank; null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length)));
  return v[rank - 1];
}
