/**
 * In-app account deletion and export (Epic 9.7; App Store 5.1.1(v), Google Play).
 *
 * - POST /api/v1/account/deletion  delete the account: content, then identity
 * - GET  /api/v1/account/export    content export + auth export in one download
 */
import { z } from 'zod';
import { AuthenticatedRoute } from '../../base';
import type { AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { collectUserData, EXPORT_FORMAT_VERSION, type PrivacyBuckets } from '../../lib/privacy/user-data';
import { DEFAULT_OPERATION_BUDGET, OperationBudget } from '../../lib/privacy/scan';
import { runErasurePass } from '../privacy/privacy';
import { REAUTH_CHALLENGE, authTimeOf, bearerToken, callAuth, isRecentSignIn } from '../../lib/account-deletion';

const DeletionResponse = z.object({
	success: z.boolean(),
	status: z.enum(['erasing', 'deleted']).describe('erasing: call again with resumeToken; deleted: done, sign the user out'),
	complete: z.boolean(),
	resumeToken: z.string().optional(),
	deleted: z.record(z.number()).optional(),
	anonymized: z.record(z.number()).optional(),
});

export class AccountDeletionPost extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Account'],
			summary: 'Delete my account (content, then identity)',
			description:
				'🔒 Requires a sign-in at most 10 minutes old (the token\'s `auth_time`); otherwise `401 insufficient_user_authentication`: sign in again with `prompt=login` and retry. Erases content in resumable passes (`status: "erasing"` → call again with `resumeToken`), then deletes the sign-in account. `502 code: auth_unavailable` is retryable: content erasure is idempotent. Body: `{ "confirm": "DELETE" }`.',
			request: {
				body: {
					content: {
						'application/json': { schema: z.object({ confirm: z.literal('DELETE'), resumeToken: z.string().max(8192).optional() }) },
					},
				},
			},
			responses: {
				'200': { description: 'Progress or done', content: { 'application/json': { schema: DeletionResponse } } },
				'400': { description: 'Missing confirmation (code: confirmation_required)' },
				'401': { description: 'Authentication required, or a recent sign-in is required (code: insufficient_user_authentication)' },
				'502': { description: 'Content erased; the identity service could not be reached (code: auth_unavailable, retry)' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		const token = bearerToken(c.req.raw);
		if (!token) return c.json({ success: false, error: 'Authentication required' }, 401);

		const { body } = await this.getValidatedData<typeof this.schema>().catch(() => ({ body: null as any }));
		if (body?.confirm !== 'DELETE') {
			return c.json({ success: false, code: 'confirmation_required', error: 'Send {"confirm":"DELETE"} to delete your account' }, 400);
		}

		// Recent sign-in, checked before anything is erased
		if (!isRecentSignIn(authTimeOf(token))) {
			return c.json(REAUTH_CHALLENGE.body, REAUTH_CHALLENGE.status, REAUTH_CHALLENGE.headers);
		}

		const summary = await runErasurePass(c, userId, body.resumeToken);
		if (!summary.complete) {
			return c.json({
				success: true,
				status: 'erasing',
				complete: false,
				resumeToken: summary.resumeToken,
				deleted: summary.deleted,
				anonymized: summary.anonymized,
			});
		}

		// Content is gone: delete the sign-in account with the user's own token
		let res: Response;
		try {
			res = await callAuth(c.env.Issuer, '/account', token, { method: 'DELETE' });
		} catch (error) {
			logger.error('[Account] Auth deletion call failed', { userId, error: String(error) });
			return c.json({ success: false, code: 'auth_unavailable', error: 'Your content was deleted. Try again to finish deleting your account.' }, 502);
		}
		if (res.status === 401) {
			// e.g. the sign-in became older than 10 minutes during erasure: sign in again and retry
			const detail = (await res.json().catch(() => ({}))) as { error?: string };
			if (detail.error === 'insufficient_user_authentication') {
				return c.json(REAUTH_CHALLENGE.body, REAUTH_CHALLENGE.status, REAUTH_CHALLENGE.headers);
			}
			return c.json({ success: false, error: 'Authentication required' }, 401);
		}
		if (!res.ok) {
			logger.error('[Account] Auth deletion refused', { userId, status: res.status });
			return c.json({ success: false, code: 'auth_unavailable', error: 'Your content was deleted. Try again to finish deleting your account.' }, 502);
		}
		logger.info('[Account] Account deleted', { userId });
		return c.json({ success: true, status: 'deleted', complete: true, deleted: summary.deleted, anonymized: summary.anonymized });
	}
}

export class AccountExportGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Account'],
			summary: 'Export my data (content and account) as one download',
			description:
				'🔒 Requires authentication. `content` is the same as `/api/privacy/export` (paged: while `content.complete` is false call again with `?resume=`; later pages carry only `content`). `account` is the sign-in account (profile, roles, sessions, audit trail) from the identity service, on the first page.',
			request: { query: z.object({ resume: z.string().max(8192).optional() }) },
			responses: {
				'200': { description: 'JSON attachment: { formatVersion, exportedAt, content, account }' },
				'401': { description: 'Authentication required' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		const token = bearerToken(c.req.raw);
		const resume = c.req.query('resume') || undefined;
		const configured = Number((c.env as unknown as { PRIVACY_OP_BUDGET?: string }).PRIVACY_OP_BUDGET);
		const budget = new OperationBudget(Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_OPERATION_BUDGET);
		const content = await collectUserData(c.env as unknown as PrivacyBuckets, userId, budget, { resumeToken: resume });

		let account: unknown = undefined;
		let accountError: string | undefined;
		if (!resume && token) {
			try {
				const res = await callAuth(c.env.Issuer, '/account/export', token);
				if (res.ok) account = await res.json();
				else accountError = `identity service answered ${res.status}`;
			} catch (error) {
				accountError = 'identity service unreachable';
				logger.warn('[Account] Auth export failed', { userId, error: String(error) });
			}
		}
		return c.json(
			{
				formatVersion: EXPORT_FORMAT_VERSION,
				exportedAt: new Date().toISOString(),
				content,
				...(resume ? {} : { account: account ?? null, ...(accountError ? { accountError } : {}) }),
			},
			200,
			{
				'Content-Disposition': `attachment; filename="al-ummah-now-account-${new Date().toISOString().slice(0, 10)}.json"`,
				'Cache-Control': 'no-store',
			},
		);
	}
}
