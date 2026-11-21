/**
 * D11: renditions pre-encoded in desktop Studio (optional; the server encodes by default).
 *
 *   POST /api/videos/:videoId/renditions                                   declare rungs and files → stagingId
 *   PUT  /api/videos/:videoId/renditions/:stagingId/files/:rung/:file      one file, raw body (≤ 32 MiB)
 *   POST /api/videos/:videoId/renditions/:stagingId/complete               every file is there → ready
 *   DELETE /api/videos/:videoId/renditions/:stagingId                      give up; the server encodes
 *
 * Owner or a channel role with `video.edit`, before the server's transcode starts (409 `too_late`).
 * When the original upload completes, the transcode job takes the ready renditions and verifies
 * them; it uses them only when they match exactly what it would have encoded (lib/media/prebuilt.ts).
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { PREBUILT_LIMITS, isPrebuiltStagingId, prebuiltStagingPrefix, type PrebuiltUploadState, type VideoObject } from '@al-ummah/shared-types';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { logger } from '../../lib/logger';
import { editableVideo } from '../captions/captionDrafts';
import { checkPlan, deleteStaging, isStale, manifestKey, missingFiles, newStagingId, readManifest, stagedSizes, tooLate, type PrebuiltManifest } from '../../lib/media/prebuilt';

type WithPrebuilt = VideoObject & { prebuilt?: PrebuiltUploadState; r2?: any };

const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string() }) } };
const State = z.object({
	stagingId: z.string(),
	status: z.enum(['uploading', 'ready', 'queued']),
	rungs: z.array(z.string()),
	files: z.number(),
	bytes: z.number(),
	createdAt: z.string(),
	encoder: z.string().optional(),
});
const stagingParams = z.object({ videoId: Str({ description: 'Video ID' }), stagingId: Str({ description: 'From POST /renditions' }) });

const videos = (c: AppContext) => new R2Repository<WithPrebuilt>(c.env.videos);

async function setState(c: AppContext, videoId: string, update: (current: PrebuiltUploadState | undefined) => PrebuiltUploadState | undefined | false): Promise<PrebuiltUploadState | undefined | false> {
	let out: PrebuiltUploadState | undefined | false = false;
	await videos(c).updateObject(videoId, (video) => {
		const next = update(video.prebuilt);
		out = next;
		if (next === false) return false;
		if (next) video.prebuilt = next;
		else delete video.prebuilt;
		return true;
	});
	return out;
}

export class RenditionsCreate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Videos'],
			summary: 'Start uploading renditions encoded on the creator\'s computer',
			description:
				'D11 (optional pre-encode in desktop Studio). Declares the HLS rungs (`360p`, `480p`, `720p`, `1080p`) and every file (`<rung>/index.m3u8`, `<rung>/init.mp4`, `<rung>/seg_00001.m4s` …) with its size. Returns a staging id for the uploads. Must happen before the original upload completes: 409 `too_late` once the server transcode has started. Replaces an earlier unfinished pre-encoded upload of the video. The server verifies the renditions before use and encodes itself if they fail.',
			request: {
				params: z.object({ videoId: Str({ description: 'Video ID' }) }),
				body: {
					content: {
						'application/json': {
							schema: z.object({
								rungs: z.array(z.string()),
								files: z.array(z.object({ path: z.string(), bytes: z.number().int() })),
								encoder: z.string().optional().describe('e.g. "Media Foundation (NVENC)"'),
							}),
						},
					},
				},
			},
			responses: {
				'201': { description: 'Staged; upload the files', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: State.extend({ maxFileBytes: z.number() }) }) } } },
				'400': { description: 'Invalid rungs or files', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Video not found', content: Err },
				'409': { description: 'The server transcode already started', content: Err },
				'503': { description: 'Storage unavailable', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		const bucket = c.env.MEDIA_PRIVATE;
		if (!bucket) return c.json({ success: false, error: 'storage_unavailable' }, 503);
		const video = access.video as WithPrebuilt;
		if (tooLate(video.r2)) return c.json({ success: false, error: 'too_late' }, 409);
		const plan = checkPlan(body);
		if (!plan.ok) {
			const failed = plan as Extract<typeof plan, { ok: false }>;
			return c.json({ success: false, error: failed.error, ...(failed.detail ? { detail: failed.detail } : {}) }, 400);
		}
		const ok = plan as Extract<typeof plan, { ok: true }>;
		const stagingId = newStagingId();
		const now = new Date().toISOString();
		const manifest: PrebuiltManifest = { v: 1, videoId: params.videoId, stagingId, rungs: ok.rungs, files: ok.files, createdAt: now, createdBy: userId, ...(body.encoder ? { encoder: body.encoder } : {}) };
		await bucket.put(manifestKey(params.videoId, stagingId), JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
		const state: PrebuiltUploadState = { stagingId, status: 'uploading', rungs: ok.rungs, files: ok.files.length, bytes: ok.bytes, createdAt: now, ...(body.encoder ? { encoder: body.encoder } : {}) };
		let replaced: string | undefined;
		const written = await setState(c, params.videoId, (current) => {
			if (current && current.status === 'queued') return false;
			replaced = current?.stagingId;
			return state;
		});
		if (written === false) {
			await deleteStaging(bucket, params.videoId, stagingId);
			return c.json({ success: false, error: 'too_late' }, 409);
		}
		if (replaced && replaced !== stagingId) await deleteStaging(bucket, params.videoId, replaced).catch(() => undefined);
		logger.info('[Renditions] Pre-encoded upload staged', { videoId: params.videoId, stagingId, rungs: ok.rungs.join(','), files: ok.files.length, bytes: ok.bytes });
		return c.json({ success: true, data: { ...state, maxFileBytes: PREBUILT_LIMITS.maxFileBytes } }, 201);
	}
}

/** The staged upload this request names, if it is still the video's current one. */
async function currentStaging(c: AppContext, videoId: string, stagingId: string, userId: string) {
	const access = await editableVideo(c, videoId, userId);
	if ('response' in access) return { response: access.response };
	const video = access.video as WithPrebuilt;
	if (!isPrebuiltStagingId(stagingId) || video.prebuilt?.stagingId !== stagingId || isStale(video.prebuilt)) return { response: c.json({ success: false, error: 'staging_not_found' }, 404) };
	if (!c.env.MEDIA_PRIVATE) return { response: c.json({ success: false, error: 'storage_unavailable' }, 503) };
	return { video, state: video.prebuilt };
}

export class RenditionFilePut extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Videos'],
			summary: 'Upload one pre-encoded rendition file',
			description: 'Raw body. The path must be one declared in POST /renditions, with exactly the declared size (400 `size_mismatch`). Uploading a file again replaces it.',
			request: { params: stagingParams.extend({ rung: Str({ description: 'Rung, e.g. 720p' }), file: Str({ description: 'File name, e.g. seg_00001.m4s' }) }) },
			responses: {
				'204': { description: 'Stored' },
				'400': { description: 'Not a declared file, or the wrong size', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such staged upload', content: Err },
				'409': { description: 'Already handed to the transcode', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const found = await currentStaging(c, params.videoId, params.stagingId, this.getUserId(c));
		if ('response' in found) return found.response;
		if (found.state!.status !== 'uploading') return c.json({ success: false, error: 'not_uploading' }, 409);
		const manifest = await readManifest(c.env.MEDIA_PRIVATE, params.videoId, params.stagingId);
		const path = `${params.rung}/${params.file}`;
		const declared = manifest?.files.find((f) => f.path === path);
		if (!declared) return c.json({ success: false, error: 'file_not_declared' }, 400);
		const length = Number(c.req.header('content-length'));
		if (Number.isFinite(length) && length !== declared.bytes) return c.json({ success: false, error: 'size_mismatch' }, 400);
		const data = await c.req.arrayBuffer();
		if (data.byteLength !== declared.bytes) return c.json({ success: false, error: 'size_mismatch' }, 400);
		await c.env.MEDIA_PRIVATE.put(`${prebuiltStagingPrefix(params.videoId, params.stagingId)}${path}`, data);
		return c.body(null, 204);
	}
}

export class RenditionsComplete extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Videos'],
			summary: 'Finish a pre-encoded upload',
			description: 'Checks every declared file is there with its size; 409 `files_missing` lists up to 50 that are not. Then the renditions wait for the original upload to complete, and its transcode job verifies them.',
			request: { params: stagingParams },
			responses: {
				'200': { description: 'Ready', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: State }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such staged upload', content: Err },
				'409': { description: 'Files missing, or too late', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const found = await currentStaging(c, params.videoId, params.stagingId, this.getUserId(c));
		if ('response' in found) return found.response;
		if (tooLate(found.video!.r2)) return c.json({ success: false, error: 'too_late' }, 409);
		if (found.state!.status !== 'uploading') return c.json({ success: true, data: found.state });
		const manifest = await readManifest(c.env.MEDIA_PRIVATE, params.videoId, params.stagingId);
		if (!manifest) return c.json({ success: false, error: 'staging_not_found' }, 404);
		const missing = missingFiles(manifest, await stagedSizes(c.env.MEDIA_PRIVATE, params.videoId, params.stagingId));
		if (missing.length) return c.json({ success: false, error: 'files_missing', missing }, 409);
		const state = await setState(c, params.videoId, (current) => (current?.stagingId === params.stagingId && current.status === 'uploading' ? { ...current, status: 'ready' } : false));
		if (state === false) return c.json({ success: false, error: 'staging_not_found' }, 404);
		logger.info('[Renditions] Pre-encoded upload ready', { videoId: params.videoId, stagingId: params.stagingId });
		return c.json({ success: true, data: state });
	}
}

export class RenditionsCancel extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Videos'],
			summary: 'Drop a pre-encoded upload',
			description: 'Deletes the staged files; the server encodes the video itself. 409 `too_late` once the transcode took them.',
			request: { params: stagingParams },
			responses: {
				'200': { description: 'Dropped', content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such staged upload', content: Err },
				'409': { description: 'Already handed to the transcode', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const found = await currentStaging(c, params.videoId, params.stagingId, this.getUserId(c));
		if ('response' in found) return found.response;
		if (found.state!.status === 'queued') return c.json({ success: false, error: 'too_late' }, 409);
		const cleared = await setState(c, params.videoId, (current) => (current?.stagingId === params.stagingId && current.status !== 'queued' ? undefined : false));
		if (cleared === false) return c.json({ success: false, error: 'too_late' }, 409);
		await deleteStaging(c.env.MEDIA_PRIVATE, params.videoId, params.stagingId);
		return c.json({ success: true });
	}
}
