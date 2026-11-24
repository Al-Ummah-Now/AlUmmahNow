/**
 * Offline & Web download endpoints (Epic 14, E14-S3a):
 *
 * - `POST /api/v1/videos/:id/downloads` — signed-in only, gated by `offlineDownloads`,
 *   per-user atomic rate limit (`offline_download`), returns either the zero-Worker R2
 *   `/pub/<videoId>/<rev>/video.mp4` URL (native apps) or the `/dl/<videoId>/<rev>/<filename>.mp4`
 *   attachment URL (Web Download button).
 * - `POST /api/v1/downloads/sync` — signed-in only, exempt from `offlineDownloads` so cleanup
 *   always works; returns uniform `available: false, reason: 'unavailable'` for missing, deleted,
 *   hidden, private, unlisted, draft, live, and not-ready videos.
 */
import { z } from 'zod';
import {
	buildDownloadAttachmentUrl,
	OFFLINE_DOWNLOAD_ERROR_CODES,
	publicMp4Path,
	type VideoR2State,
} from '@al-ummah/shared-types';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { Str } from '../../lib/chanfana-params';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { apiError } from '../../lib/api-error';
import { loadVideoRecord, videoReadAccess } from '../../lib/videoReadAccess';
import { isVideoPubliclyVisible, isVideoRemoved, type VisibilityFields } from '../../lib/visibility';
import { readDownloadRateLimit, toDownloadRateLimitConfig } from '../../lib/downloads/rate-limit-settings';
import { checkRateLimit, releaseRateLimit } from '../../middleware/rate-limit';

export interface DownloadableVideo extends VisibilityFields {
	id: string;
	title?: string;
	userId?: string;
	channelId?: string;
	isLive?: boolean;
	isDraft?: boolean;
	isUnlisted?: boolean;
	allowDownloads?: boolean;
	r2?: VideoR2State;
}

const DownloadRequestBody = z.object({
	disposition: z
		.enum(['inline', 'attachment'])
		.optional()
		.describe('Omit for native direct R2 `/pub/` URL; pass `"attachment"` for Web `/dl/` Save-As URL.'),
});

const DownloadMediaSchema = z.object({
	format: z.literal('mp4'),
	url: z.string(),
	contentType: z.literal('video/mp4'),
	bytes: z.number().int().positive().optional(),
	rung: z.string(),
});

const DownloadCreateResponse = z.object({
	videoId: z.string(),
	r2Rev: z.string(),
	media: DownloadMediaSchema,
});

const DownloadsSyncBody = z.object({
	videoIds: z.array(z.string().min(1).max(128)).max(50),
});

const DownloadsSyncResultItem = z.object({
	videoId: z.string(),
	available: z.boolean(),
	reason: z.enum(['unavailable', 'disabled_by_creator']).optional(),
});

const DownloadsSyncResponse = z.object({
	results: z.array(DownloadsSyncResultItem),
});

const DOWNLOADS_SYNC_RATE_LIMIT = {
	perMinute: 60,
	perHour: 600,
	perDay: 2000,
	maxConcurrent: 4,
} as const;

const DOWNLOADS_SYNC_BATCH_SIZE = 10;

async function isCreatorDownloadsEnabled(
	env: { channels?: R2Bucket },
	video: Pick<DownloadableVideo, 'allowDownloads' | 'channelId'>,
	channelDefaultCache?: Map<string, Promise<boolean>>,
): Promise<boolean> {
	if (video.allowDownloads === false) return false;
	if (video.allowDownloads === true) return true;
	const channelId = video.channelId;
	if (!channelId || !env.channels) return true;
	const cached = channelDefaultCache?.get(channelId);
	if (cached) return cached;
	const lookup = (async (): Promise<boolean> => {
		try {
			const obj = await env.channels!.get(channelId);
			if (!obj) return true;
			const data = (await obj.json().catch(() => null)) as { defaultAllowDownloads?: unknown } | null;
			return !(data && data.defaultAllowDownloads === false);
		} catch {
			// Fail closed so a transient channel-read error never bypasses creator opt-out.
			return false;
		}
	})();
	channelDefaultCache?.set(channelId, lookup);
	return lookup;
}

function isPubliclyDownloadableVideo(video: DownloadableVideo): boolean {
	if (isVideoRemoved(video)) return false;
	if (!isVideoPubliclyVisible(video)) return false;
	if (video.isLive === true || video.isDraft === true || video.isUnlisted === true) return false;
	return true;
}

export class VideoDownloadCreate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Downloads'],
			summary: 'Get plain R2 progressive MP4 download URL for a video',
			description:
				'🔒 Requires authentication (gated by `offlineDownloads`, per-user rate limit). ' +
				'Returns the public R2 `video.mp4` URL for native apps or an attachment `/dl/` URL when `disposition: "attachment"` is passed.',
			request: {
				params: z.object({ id: Str({ description: 'Video ID' }) }),
				body: {
					required: false,
					content: {
						'application/json': {
							schema: DownloadRequestBody,
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'Downloadable MP4 rendition URL',
					content: { 'application/json': { schema: DownloadCreateResponse } },
				},
				'401': { description: 'Authentication required' },
				'403': { description: 'Non-public/live video or creator disabled downloads' },
				'404': { description: 'Video not found or feature off' },
				'409': { description: 'R2 progressive MP4 rendition not ready' },
				'429': { description: 'Per-user download rate limit exceeded' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const auth = this.getAuth(c);

		const id = c.req.param('id') || '';
		let disposition: 'inline' | 'attachment' = 'inline';
		const contentType = c.req.header('content-type') || '';
		if (contentType.toLowerCase().includes('application/json')) {
			const raw = await c.req.text();
			if (raw.trim().length > 0) {
				let parsedJson: unknown;
				try {
					parsedJson = JSON.parse(raw);
				} catch {
					return apiError(c, 400, 'invalid_request');
				}
				const parsed = DownloadRequestBody.safeParse(parsedJson);
				if (!parsed.success) {
					return apiError(c, 400, 'validation_error');
				}
				if (parsed.data.disposition === 'attachment') {
					disposition = 'attachment';
				}
			}
		}

		const video = await loadVideoRecord<DownloadableVideo>(c.env, id);
		const readAccess = await videoReadAccess(c.env, video, auth.userId);
		if (!readAccess || !video) {
			return apiError(c, 404, 'not_found');
		}

		if (!isPubliclyDownloadableVideo(video)) {
			return apiError(c, 403, OFFLINE_DOWNLOAD_ERROR_CODES.notAllowed);
		}

		if (!(await isCreatorDownloadsEnabled(c.env, video))) {
			return apiError(c, 403, OFFLINE_DOWNLOAD_ERROR_CODES.disabled);
		}

		const mp4Path = publicMp4Path(video);
		const host = (c.env as unknown as { MEDIA_PUBLIC_HOST?: string }).MEDIA_PUBLIC_HOST;
		const mp4 = video.r2?.result?.mp4;
		if (!mp4Path || !host || !video.r2?.rev || !mp4) {
			return apiError(c, 409, OFFLINE_DOWNLOAD_ERROR_CODES.renditionNotReady);
		}

		const db = c.env.SEARCH_DB;
		if (!db) {
			return apiError(c, 503, 'service_unavailable');
		}
		{
			const settings = await readDownloadRateLimit(c.env);
			const limits = toDownloadRateLimitConfig(settings);
			const rl = await checkRateLimit(db, auth.userId, 'offline_download', limits);
			if (rl.unavailable) {
				const retryAfter = rl.retryAfter ?? 30;
				return apiError(c, 503, 'service_unavailable', { retryAfter }, { 'Retry-After': String(retryAfter) });
			}
			if (!rl.allowed) {
				const limitValue =
					rl.limitExceeded === 'minute'
						? limits.perMinute
						: rl.limitExceeded === 'hour'
							? limits.perHour
							: rl.limitExceeded === 'concurrent'
								? limits.maxConcurrent
								: limits.perDay;
				const remainingValue =
					rl.limitExceeded === 'minute'
						? rl.remaining.minute
						: rl.limitExceeded === 'hour'
							? rl.remaining.hour
							: rl.remaining.day;
				const resetValue =
					rl.limitExceeded === 'minute'
						? rl.resetAt.minute
						: rl.limitExceeded === 'hour'
							? rl.resetAt.hour
							: rl.resetAt.day;
				return apiError(
					c,
					429,
					OFFLINE_DOWNLOAD_ERROR_CODES.rateLimited,
					{
						limitExceeded: rl.limitExceeded,
						retryAfter: rl.retryAfter,
						remaining: rl.remaining,
						resetAt: rl.resetAt,
					},
					{
						'Retry-After': String(rl.retryAfter || 60),
						'X-RateLimit-Limit': String(limitValue),
						'X-RateLimit-Remaining': String(remainingValue),
						'X-RateLimit-Reset': String(resetValue),
					},
				);
			}
			c.header('X-RateLimit-Remaining-Minute', String(rl.remaining.minute));
			c.header('X-RateLimit-Remaining-Day', String(rl.remaining.day));
			if (rl.leaseId) {
				await releaseRateLimit(db, auth.userId, 'offline_download', rl.leaseId);
			}
		}

		const url =
			disposition === 'attachment'
				? buildDownloadAttachmentUrl(host, video.id, video.r2.rev, video.title)
				: `https://${host}/${mp4Path}`;

		c.header('Cache-Control', 'private, no-store');
		c.header('Vary', 'Authorization');
		return c.json({
			videoId: video.id,
			r2Rev: video.r2.rev,
			media: {
				format: 'mp4' as const,
				url,
				contentType: 'video/mp4' as const,
				...(typeof mp4.bytes === 'number' && mp4.bytes > 0 ? { bytes: mp4.bytes } : {}),
				rung: mp4.rung,
			},
		});
	}
}

export class DownloadsSync extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Downloads'],
			summary: 'Check availability of locally downloaded videos',
			description:
				'🔒 Requires authentication (exempt from `offlineDownloads` switch so cleanup always runs). ' +
				'Returns uniform `available: false, reason: "unavailable"` for missing, deleted, hidden, private, unlisted, draft, live, and not-ready videos.',
			request: {
				body: {
					content: {
						'application/json': {
							schema: DownloadsSyncBody,
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'Availability status per requested video ID',
					content: { 'application/json': { schema: DownloadsSyncResponse } },
				},
				'400': { description: 'Invalid request body' },
				'401': { description: 'Authentication required' },
				'429': { description: 'Per-user download sync rate limit exceeded' },
				'503': { description: 'Rate-limit store unavailable' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const auth = this.getAuth(c);

		const db = c.env.SEARCH_DB;
		if (!db) {
			return apiError(c, 503, 'service_unavailable');
		}
		{
			const rl = await checkRateLimit(db, auth.userId, 'offline_sync', DOWNLOADS_SYNC_RATE_LIMIT);
			if (rl.unavailable) {
				const retryAfter = rl.retryAfter ?? 30;
				return apiError(c, 503, 'service_unavailable', { retryAfter }, { 'Retry-After': String(retryAfter) });
			}
			if (!rl.allowed) {
				const limitValue =
					rl.limitExceeded === 'minute'
						? DOWNLOADS_SYNC_RATE_LIMIT.perMinute
						: rl.limitExceeded === 'hour'
							? DOWNLOADS_SYNC_RATE_LIMIT.perHour
							: rl.limitExceeded === 'concurrent'
								? DOWNLOADS_SYNC_RATE_LIMIT.maxConcurrent
								: DOWNLOADS_SYNC_RATE_LIMIT.perDay;
				const remainingValue =
					rl.limitExceeded === 'minute'
						? rl.remaining.minute
						: rl.limitExceeded === 'hour'
							? rl.remaining.hour
							: rl.remaining.day;
				const resetValue =
					rl.limitExceeded === 'minute'
						? rl.resetAt.minute
						: rl.limitExceeded === 'hour'
							? rl.resetAt.hour
							: rl.resetAt.day;
				return apiError(
					c,
					429,
					OFFLINE_DOWNLOAD_ERROR_CODES.rateLimited,
					{
						limitExceeded: rl.limitExceeded,
						retryAfter: rl.retryAfter,
						remaining: rl.remaining,
						resetAt: rl.resetAt,
					},
					{
						'Retry-After': String(rl.retryAfter || 60),
						'X-RateLimit-Limit': String(limitValue),
						'X-RateLimit-Remaining': String(remainingValue),
						'X-RateLimit-Reset': String(resetValue),
					},
				);
			}
			if (rl.leaseId) {
				await releaseRateLimit(db, auth.userId, 'offline_sync', rl.leaseId);
			}
		}

		const { body } = await this.getValidatedData<typeof this.schema>();
		const channelDefaultCache = new Map<string, Promise<boolean>>();
		const results: Array<{ videoId: string; available: boolean; reason?: 'unavailable' | 'disabled_by_creator' }> = [];

		for (let i = 0; i < body.videoIds.length; i += DOWNLOADS_SYNC_BATCH_SIZE) {
			const batch = body.videoIds.slice(i, i + DOWNLOADS_SYNC_BATCH_SIZE);
			const batchResults = await Promise.all(
				batch.map(async (videoId): Promise<{ videoId: string; available: boolean; reason?: 'unavailable' | 'disabled_by_creator' }> => {
					const video = await loadVideoRecord<DownloadableVideo>(c.env, videoId);
					if (!video || !isPubliclyDownloadableVideo(video) || !publicMp4Path(video)) {
						return { videoId, available: false, reason: 'unavailable' };
					}
					if (!(await isCreatorDownloadsEnabled(c.env, video, channelDefaultCache))) {
						return { videoId, available: false, reason: 'disabled_by_creator' };
					}
					return { videoId, available: true };
				}),
			);
			results.push(...batchResults);
		}

		c.header('Cache-Control', 'private, no-store');
		c.header('Vary', 'Authorization');
		return c.json({ results });
	}
}
