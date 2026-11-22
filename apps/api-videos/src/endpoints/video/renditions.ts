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
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { editableVideo } from '../captions/captionDrafts';
import { cancelRenditions, completeRenditions, putRenditionFile, stageRenditions, type PrebuiltOutcome, type WithPrebuilt } from '../../lib/media/prebuiltUploads';

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

/** The public answer of a renditions call (the admin import answers its own way, routers/admin.router.ts). */
function renditionsReply(c: AppContext, out: PrebuiltOutcome) {
	if (out.status === 204) return c.body(null, 204);
	if ('error' in out) return c.json({ success: false, error: out.error, ...(out.detail ?? {}) }, out.status);
	return c.json({ success: true, ...(Object.keys(out.data).length ? { data: out.data } : {}) }, out.status);
}

/** The video, when this user may edit it. */
async function editable(c: AppContext, videoId: string, userId: string) {
	const access = await editableVideo(c, videoId, userId);
	return 'response' in access ? access : { video: access.video as WithPrebuilt };
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
		const access = await editable(c, params.videoId, userId);
		if ('response' in access) return access.response;
		return renditionsReply(c, await stageRenditions(c.env, access.video, body, userId));
	}
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
		const access = await editable(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		return renditionsReply(c, await putRenditionFile(c.env, access.video, { stagingId: params.stagingId, rung: params.rung, name: params.file, contentLength: c.req.header('content-length'), body: c.req.raw.body }));
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
		const access = await editable(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		return renditionsReply(c, await completeRenditions(c.env, access.video, params.stagingId));
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
		const access = await editable(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		return renditionsReply(c, await cancelRenditions(c.env, access.video, params.stagingId));
	}
}
