/**
 * Premieres (wiki E17 §5.4), behind the `livePremieres` switch:
 *
 *   POST  /api/videos/:id/premiere         schedule this video as a premiere
 *   PATCH /api/live-streams/:id/premiere   show another video instead, before the start
 *
 * Rescheduling, cancelling, starting early and ending use the stream's own routes.
 */
import { z } from 'zod';
import { tierAllowsLiveCapability } from '@al-ummah/shared-types';
import { AppContext, AuthenticatedRoute } from '../../base';
import { apiError } from '../../lib/api-error';
import { Str } from '../../lib/chanfana-params';
import { canManageLiveStream, canOnVideo } from '../../lib/channelAccess';
import { channelOwnerTier } from '../../lib/creatorTiers';
import { featureOff } from '../../lib/features/off';
import { liveStreamIsFrozen } from '../../lib/admin/frozen';
import { CHANNEL_SUSPENDED_CODE } from '../../middleware/auth';
import { createPremiere, heldForPremiere, isPremiere, premiereProblem, premiereTimeProblem, swapPremiere, type PremiereEnv, type PremiereStream, type PremiereVideo } from '../../lib/live/premieres';
import { readStream } from '../../lib/live/streams';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { LiveChatSettingsInput } from './liveChat';
import { publicStream } from './liveSession';

const Result = { description: 'The premiere', content: { 'application/json': { schema: z.object({ success: z.boolean(), result: z.object({ stream: z.record(z.string(), z.any()) }) }) } } };
const Err = (description: string) => ({ description, content: { 'application/json': { schema: z.object({ success: z.boolean(), code: z.string().optional(), error: z.string() }) } } });
const responses = { '200': Result, '400': Err('premiere_bad_time or premiere_video_unsuitable'), '403': Err('Not allowed'), '404': Err('Not found, or the feature is off'), '409': Err('premiere_video_not_ready, premiere_video_already_open, premiere_video_scheduled, premiere_exists or premiere_started') };

const envOf = (c: AppContext) => c.env as unknown as PremiereEnv;

const STATUS: Record<string, 400 | 403 | 404 | 409> = { premiere_video_unsuitable: 400, forbidden: 403, not_found: 404 };
const refuse = (c: AppContext, problem: string) => apiError(c, STATUS[problem] ?? 409, problem);

/** The video, when the caller may schedule it and run live on its channel; a held one whose premiere is gone is freed first. */
async function scheduleable(c: AppContext, videoId: string, userId: string): Promise<PremiereVideo | Response> {
	if (videoId.includes(':')) return apiError(c, 404, 'video_not_found');
	const repo = new R2Repository<PremiereVideo>(c.env.videos);
	let video = await repo.getObject(videoId);
	if (!video || !(await canOnVideo(c.env as never, video, userId, 'video.schedule')) || !(await canManageLiveStream(c.env as never, { userId: video.userId, channelId: video.channelId }, userId))) return apiError(c, 404, 'video_not_found');
	if (video.premiereHold && !(await heldForPremiere(envOf(c), { ...video, id: videoId }))) video = (await repo.getObject(videoId)) ?? video;
	const tier = await channelOwnerTier((c.env as { SEARCH_DB: D1Database }).SEARCH_DB, video.userId);
	if (!tierAllowsLiveCapability(tier, 'livePremieres')) return featureOff(c, 'livePremieres');
	if (await liveStreamIsFrozen(c.env, { userId: video.userId, channelId: video.channelId })) return apiError(c, 403, CHANNEL_SUSPENDED_CODE);
	return { ...video, id: videoId };
}

export class VideoPremiereCreate extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Schedule a premiere',
		description: '🔒 A finished private or draft video, shown to everyone at the same time from 5 minutes to 365 days ahead. The video is closed until then; cancelling leaves it as it was.',
		request: {
			params: z.object({ id: Str({ description: 'Video id' }) }),
			body: { content: { 'application/json': { schema: z.object({ scheduledStartTime: z.string(), title: z.string().min(1).max(200).optional(), description: z.string().max(5000).optional(), ...LiveChatSettingsInput }) } } },
		},
		responses,
	});

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const now = Date.now();
		if (premiereTimeProblem(body.scheduledStartTime, now)) return apiError(c, 400, 'premiere_bad_time');
		const video = await scheduleable(c, params.id, userId);
		if (video instanceof Response) return video;
		const problem = premiereProblem(video);
		if (problem) return refuse(c, problem);
		const { scheduledStartTime, ...fields } = body;
		const made = await createPremiere(envOf(c), { video, scheduledStartTime, actorId: userId, fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) }, now);
		if ('problem' in made) return refuse(c, made.problem);
		return c.json({ success: true, result: { stream: publicStream(made.stream, true) } });
	}
}

export class PremiereSwap extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Show another video in a premiere',
		description: '🔒 Before it starts. The new video must be on the same channel and meet the same rules; the old one is free again.',
		request: { params: z.object({ id: Str({ description: 'Live stream id' }) }), body: { content: { 'application/json': { schema: z.object({ videoId: z.string().min(1).max(128) }) } } } },
		responses,
	});

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const stream = await readStream(c.env as never, params.id);
		if (!isPremiere(stream) || !(await canManageLiveStream(c.env as never, stream, userId))) return apiError(c, 404, 'not_found');
		const video = await scheduleable(c, body.videoId, userId);
		if (video instanceof Response) return video;
		const problem = premiereProblem(video);
		if (problem) return refuse(c, problem);
		const swapped = await swapPremiere(envOf(c), stream as PremiereStream, video, userId);
		if ('problem' in swapped) return refuse(c, swapped.problem);
		return c.json({ success: true, result: { stream: publicStream(swapped.stream, true) } });
	}
}
