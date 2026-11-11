/**
 * Player QoE beacons (sampled; shared-types LiveQoeBeacon) and the admin's
 * provider comparison.
 *
 * Beacons are accepted only for a session that exists, matches the stream and
 * provider, and is live or ended less than an hour ago. Values are clamped and
 * the latency samples summarised (p50, max, up to 20 raw values), so one
 * window is one small D1 row. The players sample viewers at the admin's
 * `qoeSampleRate`; viewer-hours are scaled back up by it in the comparison.
 */
import {
	LIVE_PROVIDERS,
	isLiveProvider,
	percentile,
	type LiveComparison,
	type LiveComparisonDay,
	type LiveProviderId,
	type LiveProviderStats,
	type LiveQoeBeacon,
	type LiveRoutingSettings,
} from '@al-ummah/shared-types';
import { estimateCost, readSession } from './store';

const clampInt = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);
const optInt = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null);

export class QoeRejected extends Error {}

export function parseBeacon(body: unknown): LiveQoeBeacon {
	const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
	const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
	const streamId = str(b.streamId, 64);
	const sessionId = str(b.sessionId, 64);
	const viewerKey = str(b.viewerKey, 64);
	if (!streamId || !sessionId || !viewerKey || !isLiveProvider(b.provider)) throw new QoeRejected('invalid beacon');
	const kind = b.kind === 'start' || b.kind === 'window' || b.kind === 'end' ? b.kind : null;
	if (!kind) throw new QoeRejected('invalid kind');
	const latency = Array.isArray(b.latencyMs) ? b.latencyMs.slice(0, 120).map((x) => optInt(x, 600_000)).filter((x): x is number => x !== null) : [];
	return {
		streamId,
		sessionId,
		viewerKey,
		provider: b.provider,
		kind,
		startupMs: optInt(b.startupMs, 120_000),
		latencyMs: latency,
		liveEdgeSec: typeof b.liveEdgeSec === 'number' && Number.isFinite(b.liveEdgeSec) ? Math.max(0, Math.min(3600, b.liveEdgeSec)) : null,
		rebufferCount: clampInt(b.rebufferCount, 1000),
		rebufferMs: clampInt(b.rebufferMs, 600_000),
		watchMs: clampInt(b.watchMs, 600_000),
		bitrateKbps: optInt(b.bitrateKbps, 100_000),
		renditionSwitches: clampInt(b.renditionSwitches, 1000),
		droppedFrames: clampInt(b.droppedFrames, 1_000_000),
		errors: clampInt(b.errors, 1000),
		errorCode: str(b.errorCode, 64),
	};
}

export async function recordBeacon(db: D1Database, beacon: LiveQoeBeacon, meta: { colo?: string | null; isTest?: boolean }, now = Date.now()): Promise<void> {
	const session = await readSession(db, beacon.sessionId);
	if (!session || session.stream_id !== beacon.streamId || session.provider !== beacon.provider) throw new QoeRejected('unknown session');
	if (session.status === 'failed' || (session.status === 'ended' && now - (session.ended_at ?? now) > 3_600_000)) throw new QoeRejected('session over');
	const lat = beacon.latencyMs ?? [];
	await db
		.prepare(
			`INSERT INTO live_qoe (id, session_id, stream_id, provider, viewer_key, kind, at, startup_ms, latency_p50_ms, latency_max_ms, latency_samples,
			   live_edge_sec, rebuffer_count, rebuffer_ms, watch_ms, bitrate_kbps, switches, dropped_frames, errors, error_code, colo, is_test)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			crypto.randomUUID(), beacon.sessionId, beacon.streamId, beacon.provider, beacon.viewerKey, beacon.kind, now,
			beacon.startupMs ?? null, percentile(lat, 50), lat.length ? Math.max(...lat) : null, lat.length ? JSON.stringify(lat.slice(0, 20)) : null,
			beacon.liveEdgeSec ?? null, beacon.rebufferCount ?? 0, beacon.rebufferMs ?? 0, beacon.watchMs ?? 0, beacon.bitrateKbps ?? null,
			beacon.renditionSwitches ?? 0, beacon.droppedFrames ?? 0, beacon.errors ?? 0, beacon.errorCode ?? null, meta.colo ?? null, (meta.isTest || session.is_test) ? 1 : 0,
		)
		.run();
}

type QoeRow = {
	provider: LiveProviderId;
	kind: string;
	at: number;
	startup_ms: number | null;
	latency_p50_ms: number | null;
	latency_samples: string | null;
	rebuffer_count: number;
	rebuffer_ms: number;
	watch_ms: number;
	bitrate_kbps: number | null;
	switches: number;
	dropped_frames: number;
	errors: number;
	viewer_key: string;
	session_id: string;
};

type SessionAgg = {
	id: string;
	provider: LiveProviderId;
	status: string;
	created_at: number;
	start_requested_at: number | null;
	ingest_connected_at: number | null;
	first_segment_at: number | null;
	ended_at: number | null;
	vod_ready_at: number | null;
	failover_from: string | null;
	reconnects: number;
	delivered_bytes: number;
	edge_requests: number;
	stored_bytes: number;
	ingest_bytes: number;
	peak_viewers: number;
	viewer_seconds: number;
};

const MAX_ROWS = 50_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Provider comparison for [from, to) (epoch ms). `includeTests` adds the QA test-matrix sessions. */
export async function compareProviders(db: D1Database, settings: LiveRoutingSettings, from: number, to: number, opts: { includeTests?: boolean; now?: number } = {}): Promise<LiveComparison> {
	const now = opts.now ?? Date.now();
	const testFilter = opts.includeTests ? '' : ' AND is_test = 0';
	const [{ results: sessions }, { results: qoe }, { results: reconnects }] = await Promise.all([
		db
			.prepare(
				`SELECT id, provider, status, created_at, start_requested_at, ingest_connected_at, first_segment_at, ended_at, vod_ready_at, failover_from,
				        reconnects, delivered_bytes, edge_requests, stored_bytes, ingest_bytes, peak_viewers, viewer_seconds
				   FROM live_sessions WHERE created_at >= ? AND created_at < ?${testFilter} LIMIT ${MAX_ROWS}`,
			)
			.bind(from, to)
			.all<SessionAgg>(),
		db
			.prepare(
				`SELECT provider, kind, at, startup_ms, latency_p50_ms, latency_samples, rebuffer_count, rebuffer_ms, watch_ms, bitrate_kbps, switches, dropped_frames, errors, viewer_key, session_id
				   FROM live_qoe WHERE at >= ? AND at < ?${testFilter} ORDER BY at DESC LIMIT ${MAX_ROWS}`,
			)
			.bind(from, to)
			.all<QoeRow>(),
		db.prepare("SELECT provider, value FROM live_events WHERE kind = 'reconnect' AND at >= ? AND at < ? LIMIT 10000").bind(from, to).all<{ provider: LiveProviderId; value: number }>(),
	]);
	const sample = settings.qoeSampleRate > 0 ? settings.qoeSampleRate : 1;
	const providers: LiveProviderStats[] = LIVE_PROVIDERS.map((p) => {
		const ss = (sessions ?? []).filter((s) => s.provider === p);
		const qs = (qoe ?? []).filter((q) => q.provider === p);
		const watchMs = qs.reduce((n, q) => n + q.watch_ms, 0);
		const sampledHours = watchMs / 3_600_000;
		const edgeViewerSeconds = ss.reduce((n, s) => n + (s.viewer_seconds || 0), 0);
		const viewerHours = Math.max(sampledHours / sample, edgeViewerSeconds / 3600);
		const latencies: number[] = [];
		for (const q of qs) {
			if (q.latency_samples) {
				try {
					latencies.push(...(JSON.parse(q.latency_samples) as number[]));
				} catch {
					/* malformed row: skipped */
				}
			} else if (q.latency_p50_ms != null) latencies.push(q.latency_p50_ms);
		}
		const startups = qs.map((q) => q.startup_ms).filter((x): x is number => x != null);
		const rebufferMs = qs.reduce((n, q) => n + q.rebuffer_ms, 0);
		const per = (v: number) => (sampledHours > 0 ? v / sampledHours : null);
		const streamMs = ss.reduce((n, s) => n + (s.first_segment_at ? Math.max(0, (s.ended_at ?? now) - s.first_segment_at) : 0), 0);
		const units = {
			deliveredBytes: ss.reduce((n, s) => n + s.delivered_bytes, 0),
			edgeRequests: ss.reduce((n, s) => n + s.edge_requests, 0),
			storedBytes: ss.reduce((n, s) => n + s.stored_bytes, 0),
		};
		// Bunny bills delivery; without edge counters, estimate delivered bytes from viewer time × bitrate.
		const bitrates = qs.map((q) => q.bitrate_kbps).filter((x): x is number => x != null);
		const avgBitrate = bitrates.length ? bitrates.reduce((a, b) => a + b, 0) / bitrates.length : null;
		if (!units.deliveredBytes && avgBitrate) units.deliveredBytes = viewerHours * 3600 * (avgBitrate * 1000 / 8);
		const cost = estimateCost(settings, p, { streamMs, ...units });
		const streamHours = streamMs / 3_600_000;
		const recon = (reconnects ?? []).filter((r) => r.provider === p).map((r) => r.value);
		return {
			provider: p,
			sessions: ss.length,
			failedSessions: ss.filter((s) => s.status === 'failed').length,
			failovers: ss.filter((s) => s.failover_from).length,
			streamHours,
			viewerHours,
			peakViewers: Math.max(0, ...ss.map((s) => s.peak_viewers)),
			startupMsP50: percentile(startups, 50),
			startupMsP95: percentile(startups, 95),
			latencyMsP50: percentile(latencies, 50),
			latencyMsP95: percentile(latencies, 95),
			rebufferRatio: watchMs > 0 ? rebufferMs / (watchMs + rebufferMs) : null,
			rebuffersPerViewerHour: per(qs.reduce((n, q) => n + q.rebuffer_count, 0)),
			avgBitrateKbps: avgBitrate,
			switchesPerViewerHour: per(qs.reduce((n, q) => n + q.switches, 0)),
			droppedFramesPerViewerHour: per(qs.reduce((n, q) => n + q.dropped_frames, 0)),
			errorsPerViewerHour: per(qs.reduce((n, q) => n + q.errors, 0)),
			ingestConnectMsP50: percentile(ss.filter((s) => s.ingest_connected_at && s.start_requested_at).map((s) => Math.max(0, s.ingest_connected_at! - s.start_requested_at!)), 50),
			firstSegmentMsP50: percentile(ss.filter((s) => s.first_segment_at && s.ingest_connected_at).map((s) => Math.max(0, s.first_segment_at! - s.ingest_connected_at!)), 50),
			reconnects: ss.reduce((n, s) => n + s.reconnects, 0),
			reconnectRecoveryMsP50: percentile(recon, 50),
			vodReadyMsP50: percentile(ss.filter((s) => s.vod_ready_at && s.ended_at).map((s) => Math.max(0, s.vod_ready_at! - s.ended_at!)), 50),
			estCostUsd: cost,
			costPerStreamHourUsd: streamHours > 0 ? cost / streamHours : null,
			costPerViewerHourUsd: viewerHours > 0 ? cost / viewerHours : null,
			units: {
				deliveredGb: units.deliveredBytes / 1e9,
				edgeRequests: units.edgeRequests,
				storedGb: units.storedBytes / 1e9,
				ingestGb: ss.reduce((n, s) => n + s.ingest_bytes, 0) / 1e9,
			},
			qoeSamples: qs.length,
		};
	});
	const days: LiveComparisonDay[] = [];
	const dayKeys = new Set([...(sessions ?? []).map((s) => dayOf(s.created_at)), ...(qoe ?? []).map((q) => dayOf(q.at))]);
	for (const day of [...dayKeys].sort()) {
		for (const p of LIVE_PROVIDERS) {
			const ss = (sessions ?? []).filter((s) => s.provider === p && dayOf(s.created_at) === day);
			const qs = (qoe ?? []).filter((q) => q.provider === p && dayOf(q.at) === day);
			const watch = qs.reduce((n, q) => n + q.watch_ms, 0);
			const reb = qs.reduce((n, q) => n + q.rebuffer_ms, 0);
			const lat = qs.map((q) => q.latency_p50_ms).filter((x): x is number => x != null);
			const streamMs = ss.reduce((n, s) => n + (s.first_segment_at ? Math.max(0, (s.ended_at ?? now) - s.first_segment_at) : 0), 0);
			days.push({
				day,
				provider: p,
				sessions: ss.length,
				viewerHours: watch / 3_600_000 / sample,
				latencyMsP50: percentile(lat, 50),
				rebufferRatio: watch > 0 ? reb / (watch + reb) : null,
				estCostUsd: estimateCost(settings, p, {
					streamMs,
					deliveredBytes: ss.reduce((n, s) => n + s.delivered_bytes, 0),
					edgeRequests: ss.reduce((n, s) => n + s.edge_requests, 0),
					storedBytes: ss.reduce((n, s) => n + s.stored_bytes, 0),
				}),
			});
		}
	}
	return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), providers, days };
}

/** Daily: QoE rows and segment indexes older than 90 days. */
export async function pruneLiveData(db: D1Database, now = Date.now()): Promise<void> {
	const cutoff = now - 90 * 86_400_000;
	await db.prepare('DELETE FROM live_qoe WHERE at < ?').bind(cutoff).run();
	await db.prepare('DELETE FROM live_events WHERE at < ?').bind(cutoff).run();
	await db.prepare("DELETE FROM live_segments WHERE session_id IN (SELECT id FROM live_sessions WHERE status IN ('ended', 'failed') AND ended_at < ? LIMIT 500)").bind(cutoff).run();
}
