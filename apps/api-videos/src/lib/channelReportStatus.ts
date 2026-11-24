/**
 * Whether the team is reviewing a report about a channel. Reports live in admin-api
 * (REPORTS_DB), which answers GET /internal/channel-reports/:id (X-API-Key).
 */
import { logger } from './logger';

export interface ReportStatusEnv {
	ADMIN_API_URL?: string;
	INTERNAL_API_KEY?: unknown;
}

const TIMEOUT_MS = 3000;

async function keyOf(binding: unknown): Promise<string> {
	if (typeof binding === 'string') return binding.trim();
	const get = (binding as { get?: () => Promise<string> } | null | undefined)?.get;
	return typeof get === 'function' ? ((await get.call(binding)) ?? '').trim() : '';
}

/** True or false, or null when admin-api can't say (unreachable, refused, or not configured here): the caller refuses the move. */
export async function channelReportUnderReview(env: ReportStatusEnv, channelId: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
	const base = (env.ADMIN_API_URL ?? '').replace(/\/$/, '');
	if (!base) {
		logger.error('[ChannelMoves] ADMIN_API_URL is not set; a channel can’t be checked, so it can’t be moved', { channelId });
		return null;
	}
	try {
		const res = await fetchImpl(`${base}/internal/channel-reports/${encodeURIComponent(channelId)}`, { headers: { 'X-API-Key': await keyOf(env.INTERNAL_API_KEY) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
		const body = res.ok ? ((await res.json()) as { result?: { underReview?: unknown } }) : null;
		if (typeof body?.result?.underReview === 'boolean') return body.result.underReview;
		logger.warn('[ChannelMoves] Report status read failed', { channelId, status: res.status });
	} catch (error) {
		logger.warn('[ChannelMoves] Report status unreachable', { channelId, error: error instanceof Error ? error.message : String(error) });
	}
	return null;
}
