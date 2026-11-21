/**
 * Workers Analytics Engine SQL API client of the admin panels that read it: Web vitals
 * (routers/vitals.router.ts) and Abuse (routers/abuse.router.ts). Both use CF_ANALYTICS_TOKEN
 * (Secrets Store `media-cdn-api-token`), which needs **Account → Account Analytics → Read**.
 *
 * Every failure is classified (AnalyticsFailure), logged with Cloudflare's error body (never the
 * token) and flagged on the admin Errors page as one needs-action item per panel, with a Retry that
 * checks the token again. A dataset nobody has written to yet does not exist: that is "no data", not
 * an error. A later successful read closes the item.
 */
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { logger } from './logger';

export { newErrorRef };

export type AnalyticsPanel = 'vitals' | 'abuse';

/**
 * Why a read failed:
 * - auth: Cloudflare refused the token (401/403, error 10000): it lacks Account Analytics Read or was revoked
 * - rate_limited: Cloudflare throttled the account's SQL API calls (429; repeated auth failures also end here)
 * - query: Cloudflare rejected the SQL (4xx other than the above)
 * - upstream: Cloudflare answered 5xx
 * - unreachable: the request did not reach Cloudflare
 * - bad_response: a 2xx whose body is not the SQL API's JSON
 */
export const ANALYTICS_FAILURES = ['auth', 'rate_limited', 'query', 'upstream', 'unreachable', 'bad_response'] as const;
export type AnalyticsFailure = (typeof ANALYTICS_FAILURES)[number];

export class AnalyticsEngineError extends Error {
	constructor(
		public readonly reason: AnalyticsFailure,
		/** HTTP status from Cloudflare (0 when it was not reached) */
		public readonly status: number,
		/** Cloudflare's error text, shortened: what the Errors page shows */
		public readonly detail: string,
	) {
		super(`Analytics Engine ${reason}${status ? ` (HTTP ${status})` : ''}: ${detail}`.slice(0, 500));
		this.name = 'AnalyticsEngineError';
	}
}

/** The SQL API's answer when the table (dataset) has never been written to */
export function isMissingTable(text: string): boolean {
	return /unknown table|table .* (does not|doesn't) exist|does not exist|unable to find table|no such table/i.test(text);
}

/** Cloudflare's own error messages from a v4 envelope, else the raw text (shortened) */
export function cloudflareErrorText(text: string): string {
	try {
		const errors = (JSON.parse(text) as { errors?: Array<{ code?: number; message?: string }> }).errors;
		if (Array.isArray(errors) && errors.length) {
			return errors.map((e) => `${e.code ?? ''}${e.code ? ' ' : ''}${e.message ?? ''}`.trim()).join('; ').slice(0, 300);
		}
	} catch {
		// not JSON: the SQL API answers query errors as plain text
	}
	return text.trim().slice(0, 300);
}

/** Classifies a non-2xx answer (a missing table is handled before this) */
export function classifyFailure(status: number, text: string): AnalyticsFailure {
	if (status === 401 || status === 403 || /"code"\s*:\s*10000\b|authentication error/i.test(text)) return 'auth';
	if (status === 429 || /"code"\s*:\s*10429\b/.test(text)) return 'rate_limited';
	if (status >= 500) return 'upstream';
	return 'query';
}

/**
 * One SQL API call. Returns the rows; [] when the dataset does not exist yet. Throws
 * AnalyticsEngineError (already logged) on any failure.
 */
export async function analyticsQuery(
	account: string,
	token: string,
	sql: string,
	opts: { panel: AnalyticsPanel; fetchImpl?: typeof fetch } = { panel: 'vitals' },
): Promise<Array<Record<string, unknown>>> {
	const tag = opts.panel === 'vitals' ? '[Vitals]' : '[Abuse]';
	let res: Response;
	try {
		res = await (opts.fetchImpl ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: sql,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		logger.error(`${tag} Analytics Engine unreachable`, { reason: 'unreachable', error: detail });
		throw new AnalyticsEngineError('unreachable', 0, detail.slice(0, 300));
	}
	const text = await res.text();
	if (!res.ok && isMissingTable(text)) return [];
	if (!res.ok) {
		const reason = classifyFailure(res.status, text);
		const detail = cloudflareErrorText(text);
		logger.error(`${tag} Analytics Engine query failed`, { reason, status: res.status, body: detail });
		throw new AnalyticsEngineError(reason, res.status, detail);
	}
	try {
		const data = (JSON.parse(text) as { data?: unknown }).data;
		if (data === undefined) return [];
		if (!Array.isArray(data)) throw new Error('data is not a list');
		return data as Array<Record<string, unknown>>;
	} catch (error) {
		const detail = `Unexpected answer: ${text.slice(0, 120)}`;
		logger.error(`${tag} Analytics Engine answer unreadable`, { reason: 'bad_response', status: res.status, error: error instanceof Error ? error.message : String(error) });
		throw new AnalyticsEngineError('bad_response', res.status, detail);
	}
}

/** Reads a Secrets Store binding (or a plain string in tests and local dev); '' when unset */
export async function readSecret(binding: unknown): Promise<string> {
	if (typeof binding === 'string') return binding;
	try {
		return ((await (binding as { get?: () => Promise<string> })?.get?.()) ?? '') || '';
	} catch {
		return '';
	}
}

/** The token and account, or null when this environment has neither */
export async function analyticsCredentials(env: unknown): Promise<{ token: string; account: string } | null> {
	const b = env as { CF_ANALYTICS_TOKEN?: unknown; CLOUDFLARE_ACCOUNT_ID?: string };
	const token = await readSecret(b.CF_ANALYTICS_TOKEN);
	const account = b.CLOUDFLARE_ACCOUNT_ID ?? '';
	return token && account ? { token, account } : null;
}

const PANEL = {
	vitals: { title: 'Web vitals could not be read', url: '/web-vitals' },
	abuse: { title: 'Abuse counters could not be read', url: '/abuse' },
} as const;

/** What an admin should do about each failure (shown on the Errors page item) */
const FIX: Record<AnalyticsFailure, string> = {
	auth: 'Cloudflare refused CF_ANALYTICS_TOKEN (Secrets Store "media-cdn-api-token"). Add the permission Account → Account Analytics → Read to that API token, then press Check again.',
	rate_limited: 'Cloudflare is throttling Analytics Engine SQL calls for the account. Wait a minute and press Check again.',
	query: 'Cloudflare rejected the panel\'s SQL. This is a bug in admin-api; the detail says which part.',
	upstream: 'Cloudflare\'s Analytics Engine answered with a server error. Press Check again in a few minutes.',
	unreachable: 'admin-api could not reach api.cloudflare.com. Press Check again in a few minutes.',
	bad_response: 'Cloudflare answered with something that is not the SQL API\'s JSON. Press Check again; if it persists, the API changed.',
};

/** The Errors pipeline is there (its queue, or D1 for the inline write in local dev) */
const errorsPipeline = (env: AdminBindings) => Boolean((env as { ERRORS_QUEUE?: unknown }).ERRORS_QUEUE || env.REPORTS_DB);

/** One open item per panel: a new failure updates it, a successful read closes it */
export const analyticsItemKey = (panel: AnalyticsPanel) => `analytics-engine:${panel}`;

/**
 * Flags the failure on the Errors page (needs action, Retry = "Check again") under `ref`, the
 * reference the panel shows next to its error. Never throws.
 */
export async function flagAnalyticsFailure(env: AdminBindings, panel: AnalyticsPanel, failure: AnalyticsEngineError, ref = newErrorRef()): Promise<string> {
	if (!errorsPipeline(env)) return ref;
	try {
		const event = scrubEvent({
			app: 'admin-api',
			kind: 'action',
			ref,
			name: failure.name,
			message: `${FIX[failure.reason]} Cloudflare said${failure.status ? ` (HTTP ${failure.status})` : ''}: ${failure.detail}`.slice(0, 900),
			environment: env.ENVIRONMENT,
			occurredAt: new Date().toISOString(),
			extra: { panel, reason: failure.reason, status: failure.status },
			action: {
				key: analyticsItemKey(panel),
				source: 'ops',
				title: PANEL[panel].title,
				itemType: 'admin-panel',
				itemId: panel,
				itemUrl: PANEL[panel].url,
				retry: { kind: 'builtin', handler: 'analytics-engine', args: { panel } },
				retryLabel: 'Check again',
			},
		});
		if (!event) return ref;
		// Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
		const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
		await ingestAndAlert(env, [event]);
	} catch (error) {
		logger.error('[Analytics] Could not flag the failure on the Errors page', { panel, error: error instanceof Error ? error.message : String(error) });
	}
	return ref;
}

/** Closes the panel's item after a successful read. Never throws. */
export async function resolveAnalyticsFailure(env: AdminBindings, panel: AnalyticsPanel): Promise<void> {
	if (!errorsPipeline(env)) return;
	try {
		const { enqueueIngest } = await import('../endpoints/errors/ErrorsIngest');
		await enqueueIngest(env, { v: 1, events: [], resolved: [analyticsItemKey(panel)], trustedRetry: true, receivedAt: new Date().toISOString() });
	} catch (error) {
		logger.error('[Analytics] Could not resolve the Errors page item', { panel, error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * The Errors page "Check again" (lib/errors-actions.ts BUILTIN_RETRIES 'analytics-engine'): one cheap
 * SQL call with the same token. Resolves the item when Cloudflare accepts it.
 */
export async function checkAnalyticsAccess(env: AdminBindings, fetchImpl?: typeof fetch): Promise<{ ok: boolean; result: string }> {
	const creds = await analyticsCredentials(env);
	if (!creds) return { ok: false, result: 'CF_ANALYTICS_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set for this environment' };
	try {
		await analyticsQuery(creds.account, creds.token, 'SHOW TABLES', { panel: 'vitals', fetchImpl });
		return { ok: true, result: 'Cloudflare accepted the token' };
	} catch (error) {
		const e = error as AnalyticsEngineError;
		return { ok: false, result: `Still failing (${e.reason ?? 'error'}${e.status ? `, HTTP ${e.status}` : ''}): ${e.detail ?? String(error)}`.slice(0, 300) };
	}
}
