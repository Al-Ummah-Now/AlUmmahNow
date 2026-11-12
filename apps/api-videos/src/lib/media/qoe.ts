/**
 * Player measurements per source (epic #687): one upsert per play session into
 * playback_qoe_daily (migrations/search/0020). Sums only, so the comparison page
 * divides: startup = startup_ms_sum / started, rebuffer ratio = rebuffer_ms / watch_ms,
 * average bitrate = kbps_watch_s / (watch_ms / 1000).
 */
import { logger } from '../logger';

export const QOE_DEVICES = ['desktop', 'mobile', 'tablet', 'tv', 'other'] as const;

export interface QoeReport {
	day: string;
	source: 'bunny' | 'r2';
	device: (typeof QOE_DEVICES)[number];
	country: string;
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

export async function recordQoe(env: { SEARCH_DB?: D1Database }, r: QoeReport): Promise<void> {
	if (!env.SEARCH_DB) return;
	const started = r.started ? 1 : 0;
	try {
		await env.SEARCH_DB.prepare(
			`INSERT INTO playback_qoe_daily (day, provider, device, country, sessions, started, startup_ms_sum, rebuffers, rebuffer_ms, watch_ms, kbps_watch_s, peak_kbps_sum, switches, errors, fallbacks)
			 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
			 ON CONFLICT (day, provider, device, country) DO UPDATE SET
			   sessions = sessions + 1, started = started + excluded.started, startup_ms_sum = startup_ms_sum + excluded.startup_ms_sum,
			   rebuffers = rebuffers + excluded.rebuffers, rebuffer_ms = rebuffer_ms + excluded.rebuffer_ms, watch_ms = watch_ms + excluded.watch_ms,
			   kbps_watch_s = kbps_watch_s + excluded.kbps_watch_s, peak_kbps_sum = peak_kbps_sum + excluded.peak_kbps_sum,
			   switches = switches + excluded.switches, errors = errors + excluded.errors, fallbacks = fallbacks + excluded.fallbacks`,
		)
			.bind(
				r.day,
				r.source,
				r.device,
				/^[A-Z]{2}$/.test(r.country) ? r.country : 'XX',
				started,
				r.started && r.startupMs !== undefined ? Math.round(r.startupMs) : 0,
				r.rebuffers,
				r.rebufferMs,
				r.watchMs,
				(r.avgKbps ?? 0) * (r.watchMs / 1000),
				Math.round(r.peakKbps ?? 0),
				r.switches,
				r.errors,
				r.fallback ? 1 : 0,
			)
			.run();
	} catch (error) {
		logger.warn('[QoE] Could not record a session', { error: error instanceof Error ? error.message : String(error) });
	}
}
