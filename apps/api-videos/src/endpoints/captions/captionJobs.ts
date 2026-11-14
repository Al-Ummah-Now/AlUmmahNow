/**
 * On-demand transcription (AUN-CAPTIONS §5.1): a creator asks for captions of a
 * video in the language spoken in it; the job runs in the background and ends
 * with a caption draft the creator reviews (captionDrafts.ts).
 *
 *   POST /api/videos/:videoId/captions/jobs                  { language, replace? } start (or return the active job)
 *   GET  /api/videos/:videoId/captions/jobs                  recent jobs of the video
 *   POST /api/videos/:videoId/captions/jobs/:jobId/cancel    cancel; the minutes come back
 *   GET  /api/videos/:videoId/captions/minutes               caption minutes left for this video's channel
 *
 * Owner or a channel role with `video.edit`. Minutes come from the channel
 * owner's creator tier and admin grants (lib/captions/minutes.ts); 402
 * `upgrade_required` when they would run out.
 */
import { Str } from 'chanfana';
import { z } from 'zod';
import { CAPTION_JOB_ERRORS, CAPTION_JOB_STATUSES, CAPTION_MINUTES_ENTITLEMENT, captionMinutesFor } from '@al-ummah/shared-types';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { SubtitleService } from '../../lib/subtitles';
import { CaptionJobHttpError, cancelJob, listJobs, minutesForVideo, requestCaptionJob } from '../../lib/captions/jobs';
import { CaptionMinutesError } from '../../lib/captions/minutes';
import { logger } from '../../lib/logger';
import { editableVideo } from './captionDrafts';

const Job = z.object({
	id: z.string(),
	videoId: z.string(),
	language: z.string(),
	replace: z.boolean().describe('Replaces the existing draft of the language when it ends'),
	status: z.enum(CAPTION_JOB_STATUSES),
	progress: z.object({ done: z.number(), total: z.number() }).nullable().describe('Audio chunks transcribed'),
	minutesReserved: z.number(),
	minutesCharged: z.number().nullable(),
	waived: z.boolean().describe('Run again by an admin free of charge'),
	error: z.enum(CAPTION_JOB_ERRORS).nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	finishedAt: z.string().nullable(),
});
const Usage = z.object({
	period: z.string().describe('UTC month, YYYY-MM'),
	resetsAt: z.string().describe("When the month's allowance starts again"),
	unlimited: z.boolean(),
	via: z.enum(['tier', 'super_admin', 'none']),
	tierMinutes: z.number().describe("The creator tier's minutes per month"),
	monthGranted: z.number().describe('Minutes an admin granted for this month'),
	monthLimit: z.number().nullable().describe('tierMinutes + monthGranted; null when unlimited'),
	monthUsed: z.number().describe('Spent or held by running jobs this month'),
	packsRemaining: z.number().describe('Minutes left on "until used" grants'),
	remaining: z.number().nullable().describe('What a new job may spend now; null when unlimited'),
	warning: z.boolean().describe("80% of the month's allowance is spent"),
});
const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string() }) } };
const videoParams = z.object({ videoId: Str({ description: 'Video ID' }) });

type RolesAuth = { payload?: { roles?: string[] } } | undefined;
const rolesOf = (c: AppContext) => (c.get('auth' as never) as RolesAuth)?.payload?.roles;

/** Strips the internal fields of a job for the Studio. */
const publicJob = ({ subjectId: _s, requestedBy: _r, channelId: _c, provider: _p, model: _m, kind: _k, ...job }: Awaited<ReturnType<typeof listJobs>>[number]) => job;

function failure(c: AppContext, error: unknown) {
	if (error instanceof CaptionJobHttpError || error instanceof CaptionMinutesError) {
		return c.json({ success: false, error: error instanceof CaptionJobHttpError ? error.code : error.message }, error.status as 400);
	}
	logger.error('[CaptionJobs] Request failed', { error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, error: 'internal_error' }, 500);
}

export class CaptionJobCreate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Transcribe a video into a caption draft',
			description:
				'Starts a background job that transcribes the language spoken in the video; Quran recitation is written from the official text. ' +
				'Asking again while a job of the same language runs returns that job (200). ' +
				'Reserves `ceil(duration in minutes)` caption minutes; a failed or cancelled job gives them back. ' +
				'409 `draft_exists` unless `replace`; 402 `upgrade_required` when the minutes would run out.',
			request: {
				params: videoParams,
				body: { content: { 'application/json': { schema: z.object({ language: Str({ description: 'ISO 639-1 code of the speech' }), replace: z.boolean().optional() }) } } },
			},
			responses: {
				'200': { description: 'A job of this language is already running', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ job: Job, existing: z.literal(true) }) }) } } },
				'202': { description: 'Started', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ job: Job, existing: z.literal(false) }) }) } } },
				'400': { description: 'Unsupported language', content: Err },
				'402': {
					description: 'Not enough caption minutes',
					content: {
						'application/json': {
							schema: z.object({ success: z.literal(false), error: z.literal('upgrade_required'), entitlement: z.literal(CAPTION_MINUTES_ENTITLEMENT), minutesNeeded: z.number(), usage: Usage }),
						},
					},
				},
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Video not found', content: Err },
				'409': { description: '`draft_exists` or `video_not_ready`', content: Err },
				'503': { description: 'Could not start the job; nothing was charged', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		const language = body.language.toLowerCase();
		if (!new SubtitleService().validateLanguage(language)) return c.json({ success: false, error: 'unsupported_language' }, 400);
		try {
			const outcome = await requestCaptionJob(c.env as never, { video: access.video, userId, roles: rolesOf(c), language, replace: body.replace === true });
			if ('refused' in outcome) {
				return c.json({ success: false, error: 'upgrade_required', entitlement: CAPTION_MINUTES_ENTITLEMENT, minutesNeeded: outcome.minutes, usage: outcome.usage }, 402);
			}
			return c.json({ success: true, data: { job: publicJob(outcome.job), existing: outcome.existing } }, outcome.existing ? 200 : 202);
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class CaptionJobsList extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'List transcription jobs of a video',
			request: { params: videoParams },
			responses: {
				'200': { description: 'Newest first (20)', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ jobs: z.array(Job) }) }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Video not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		try {
			return c.json({ success: true, data: { jobs: (await listJobs(c.env as never, params.videoId)).map(publicJob) } });
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class CaptionJobCancel extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Cancel a transcription job',
			description: 'Gives back its reserved minutes. A job that already ended is returned unchanged; one writing its draft is 409 `job_finishing` (cancellable after 90 minutes without progress).',
			request: { params: videoParams.extend({ jobId: Str({ description: 'Job ID' }) }) },
			responses: {
				'200': { description: 'The job', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ job: Job }) }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such video or job', content: Err },
				'409': { description: '`job_finishing`: the draft is being written', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		try {
			return c.json({ success: true, data: { job: publicJob(await cancelJob(c.env as never, params.videoId, params.jobId)) } });
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class CaptionMinutesGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Caption minutes for transcribing this video',
			description: "The usage of the channel owner's minutes this month, and what transcribing this video would take.",
			request: { params: videoParams },
			responses: {
				'200': {
					description: 'Usage',
					content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ usage: Usage, minutesNeeded: z.number().nullable() }) }) } },
				},
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Video not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		try {
			const usage = await minutesForVideo(c.env as never, access.video, userId, rolesOf(c));
			const duration = access.video.duration;
			return c.json({ success: true, data: { usage, minutesNeeded: typeof duration === 'number' && duration > 0 ? captionMinutesFor(duration, 1) : null } });
		} catch (error) {
			return failure(c, error);
		}
	}
}
