import { removeCollectionsFor } from '../../lib/channelCollection';
import { bunnyClientForVideo, type LibraryHints } from '../../lib/bunny/libraries';
/**
 * GDPR data subject rights endpoints (Story 1.3, AC 2, 3).
 *
 *   GET    /api/privacy/export    download everything stored about the caller (JSON)
 *   DELETE /api/privacy/data      erase / anonymise the caller's data (idempotent; repeat while complete=false)
 *   GET    /api/privacy/consent   the caller's recorded consent (audit trail)
 *   PUT    /api/privacy/consent   record a consent decision made in the web app
 *
 * Errors carry a stable `code`; the web app maps codes to its en/ar strings.
 * The sign-in account itself is managed by the separate AlUmmahNowAuth service.
 */

import { z } from 'zod';
import { DEFAULT_CAS_ATTEMPTS } from '../../lib/r2Repo';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { requireSecret } from '../../lib/env-helpers';
import Queue, { MessageType } from '../../lib/queue';
import { BunnyStreamClient } from '../../lib/bunny/stream';
import { DEFAULT_OPERATION_BUDGET, OperationBudget, asBucket, readJson, updateJson } from '../../lib/privacy/scan';
import { collectUserData, eraseUserData, type PrivacyBuckets } from '../../lib/privacy/user-data';

export const CONSENT_HISTORY_LIMIT = 50;

const ConsentRecordSchema = z.object({
	version: z.number().int().min(1),
	analytics: z.boolean(),
	experiments: z.boolean(),
	performance: z.boolean(),
	decidedAt: z.string().datetime(),
	source: z.string().max(64).optional(),
});

export type ConsentRecord = z.infer<typeof ConsentRecordSchema> & { recordedAt: string };

function buckets(c: AppContext): PrivacyBuckets {
	return c.env as unknown as PrivacyBuckets;
}

function budgetFor(c: AppContext): OperationBudget {
	const configured = Number((c.env as unknown as { PRIVACY_OP_BUDGET?: string }).PRIVACY_OP_BUDGET);
	return new OperationBudget(Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_OPERATION_BUDGET);
}

export class PrivacyExport extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Privacy'],
			summary: 'Export all data stored about the authenticated user (GDPR Art. 15 / 20)',
			description:
				'Returns profile, channels, owned video metadata, comments, reactions, subscriptions, watch history, community posts/comments/likes/votes, playlists, upload templates, reports filed and the consent record. `complete: false` means the scan budget ran out: call again with `?resume=<resumeToken>` and concatenate the array sections.',
			request: {
				query: z.object({ resume: z.string().max(8192).optional() }),
			},
			responses: {
				'200': { description: 'Machine-readable export (JSON attachment)' },
				'401': { description: 'Authentication required' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		const budget = budgetFor(c);
		const resumeToken = c.req.query('resume') || undefined;
		const data = await collectUserData(buckets(c), userId, budget, { resumeToken });
		logger.debug('[Privacy] Data export generated', { userId, complete: data.complete, operations: budget.spent });
		return c.json(data, 200, {
			'Content-Disposition': `attachment; filename="al-ummah-now-data-${new Date().toISOString().slice(0, 10)}.json"`,
			'Cache-Control': 'no-store',
		});
	}
}

export class PrivacyErase extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Privacy'],
			summary: 'Erase the authenticated user\'s data (GDPR Art. 17)',
			description:
				'Deletes the profile, owned channels/videos/playlists/posts, watch history, subscriptions, likes, votes and templates; anonymises comments and reports filed. Requires `{ "confirm": "DELETE" }`. Idempotent and resumable: while `complete` is false, call again with the returned `resumeToken`.',
			request: {
				body: {
					content: {
						'application/json': { schema: z.object({ confirm: z.literal('DELETE'), resumeToken: z.string().max(8192).optional() }) },
					},
				},
			},
			responses: {
				'200': { description: 'Erasure summary' },
				'400': { description: 'Missing confirmation (code: confirmation_required)' },
				'401': { description: 'Authentication required' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		let body: { confirm?: unknown; resumeToken?: unknown } = {};
		try {
			body = await c.req.json();
		} catch {
			body = {};
		}
		if (body?.confirm !== 'DELETE') {
			return c.json({ success: false, code: 'confirmation_required', error: 'Send {"confirm":"DELETE"} to erase your data' }, 400);
		}

		const env = c.env;
		const onVideoDeleted = async (videoId: string, video?: LibraryHints) => {
			try {
				// The video's own library (lib/bunny/libraries.ts)
				const bunny = await bunnyClientForVideo(env as never, video);
				await bunny.client.deleteVideo(bunny.libraryId, videoId);
			} catch (error) {
				// Media removal is best-effort: the R2 record is already gone, so the
				// stream is unreachable from the app. Logged for manual follow-up.
				logger.warn('[Privacy] Failed to delete Bunny Stream media', {
					videoId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		};

		const budget = budgetFor(c);
		const resumeToken = typeof body.resumeToken === 'string' ? body.resumeToken : undefined;
		const onProfileDeleted = (id: string, profile: unknown) => removeCollectionsFor(env as never, id, profile as never).then(() => undefined);
		const summary = await eraseUserData(buckets(c), userId, budget, { onVideoDeleted, onProfileDeleted }, { resumeToken });

		try {
			const queue = new Queue(c.env.queue);
			if (summary.complete) {
				// Lets the processor anonymise copies it owns (D1 moderation reports).
				await queue.send(MessageType.UserDataErased, { userId, timestamp: new Date().toISOString() });
			}
			for (const videoId of summary.deletedVideoIds) {
				await queue.send(MessageType.VideoDelete, { videoId, userId, reason: 'gdpr-erasure', timestamp: new Date().toISOString() });
			}
		} catch (error) {
			logger.error('[Privacy] Failed to queue erasure follow-up', { userId, error: error instanceof Error ? error.message : String(error) });
		}

		logger.debug('[Privacy] User data erased', {
			userId,
			complete: summary.complete,
			deleted: summary.deleted,
			anonymized: summary.anonymized,
			operations: budget.spent,
		});
		return c.json({ success: true, ...summary });
	}
}

export class PrivacyConsentGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Privacy'],
			summary: 'Get the recorded consent decisions of the authenticated user',
			responses: { '200': { description: 'Current decision and history' }, '401': { description: 'Authentication required' } },
		},
		'required',
	);

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		const profile = await readJson<Record<string, any>>(asBucket(c.env.profiles), userId, new OperationBudget(2));
		return c.json({ success: true, consent: profile?.privacyConsent ?? null });
	}
}

/** Append a consent decision to a profile's audit trail (pure; exported for tests). */
export function appendConsentRecord(profile: Record<string, any>, record: ConsentRecord): Record<string, any> {
	const previous = profile.privacyConsent?.history;
	const history = Array.isArray(previous) ? [...previous, record].slice(-CONSENT_HISTORY_LIMIT) : [record];
	return { ...profile, privacyConsent: { current: record, history } };
}

export class PrivacyConsentPut extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Privacy'],
			summary: 'Record a consent decision (audit trail)',
			request: { body: { content: { 'application/json': { schema: ConsentRecordSchema } } } },
			responses: {
				'200': { description: 'Recorded' },
				'400': { description: 'Invalid consent record (code: invalid_consent)' },
				'401': { description: 'Authentication required' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			raw = null;
		}
		const parsed = ConsentRecordSchema.safeParse(raw);
		if (!parsed.success) {
			return c.json({ success: false, code: 'invalid_consent', error: 'Invalid consent record' }, 400);
		}

		// A get and a put per attempt: the retry bound, not the budget, ends a lost race
		// (ConcurrentUpdateError, a 503 with Retry-After; 12 ran out after 6 attempts as a 500)
		const budget = new OperationBudget(2 * DEFAULT_CAS_ATTEMPTS);
		const profiles = asBucket(c.env.profiles);
		const record: ConsentRecord = { ...parsed.data, recordedAt: new Date().toISOString() };
		// Conditional write on the fresh profile (SCALABILITY-AUDIT AV-23), so a
		// concurrent profile change and the consent record both stay
		const profile = await updateJson<Record<string, any>>(profiles, userId, (fresh) => {
			Object.assign(fresh, appendConsentRecord(fresh, record));
		}, budget);
		if (!profile) {
			// No profile yet: the browser cookie remains the record until one exists.
			return c.json({ success: true, stored: false });
		}
		logger.debug('[Privacy] Consent recorded', { userId, analytics: record.analytics, experiments: record.experiments, performance: record.performance });
		return c.json({ success: true, stored: true });
	}
}
