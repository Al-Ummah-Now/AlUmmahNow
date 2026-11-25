/**
 * What became of the reports a person filed, for their data export. Reports are decided in admin-api
 * (REPORTS_DB), which answers POST /internal/report-outcomes (X-API-Key) with the outcome and its date only.
 */
import type { ReportFiledOutcome } from '@al-ummah/shared-types';
import { getSecret } from './env-helpers';
import { logger } from './logger';
import type { ReportStatusEnv } from './channelReportStatus';

const TIMEOUT_MS = 5000;
/** Reports in one request (admin-api takes 500). */
export const OUTCOMES_PER_REQUEST = 200;

export interface FiledOutcome {
	outcome: ReportFiledOutcome;
	decidedAt: string | null;
}

const OUTCOMES: readonly ReportFiledOutcome[] = ['open', 'kept', 'action_taken', 'dismissed'];

/** Outcome per report id; a report admin-api does not have yet is not in it. Null when it can't say: the export says so too. */
export async function reportOutcomes(env: ReportStatusEnv, reporterId: string, ids: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, FiledOutcome> | null> {
	const base = (env.ADMIN_API_URL ?? '').replace(/\/$/, '');
	if (!base) {
		logger.warn('[Privacy] ADMIN_API_URL is not set; an export has no report outcomes');
		return null;
	}
	try {
		const res = await fetchImpl(`${base}/internal/report-outcomes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-API-Key': (await getSecret(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY')).trim() },
			body: JSON.stringify({ reporterId, ids }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const body = res.ok ? ((await res.json()) as { result?: { outcomes?: unknown } }) : null;
		const rows = body?.result?.outcomes;
		if (Array.isArray(rows)) {
			const out = new Map<string, FiledOutcome>();
			for (const r of rows as Array<{ id?: unknown; outcome?: unknown; decidedAt?: unknown }>) {
				if (typeof r?.id === 'string' && OUTCOMES.includes(r.outcome as ReportFiledOutcome)) out.set(r.id, { outcome: r.outcome as ReportFiledOutcome, decidedAt: typeof r.decidedAt === 'string' ? r.decidedAt : null });
			}
			return out;
		}
		logger.warn('[Privacy] Report outcomes read failed', { status: res.status });
	} catch (error) {
		logger.warn('[Privacy] Report outcomes unreachable', { error: error instanceof Error ? error.message : String(error) });
	}
	return null;
}
