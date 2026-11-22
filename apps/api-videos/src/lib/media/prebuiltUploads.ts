/**
 * D11: uploading renditions encoded on the creator's (or an importing admin's) computer, without the
 * access check. Two callers decide who may: the public routes (endpoints/video/renditions.ts, owner or
 * `video.edit`) and admin-api's Admin Tools import (routers/admin.router.ts, `imports:manage`).
 *
 * stage → put each file → complete, or cancel; the first transcode then verifies them (prebuilt.ts).
 */
import { PREBUILT_LIMITS, isPrebuiltStagingId, prebuiltStagingPrefix, type PrebuiltUploadState, type VideoObject, type VideoR2State } from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { checkPlan, deleteStaging, isStale, manifestKey, missingFiles, newStagingId, readManifest, stagedSizes, tooLate, type PrebuiltManifest } from './prebuilt';

export type WithPrebuilt = VideoObject & { prebuilt?: PrebuiltUploadState; r2?: VideoR2State };

export interface PrebuiltEnv {
	videos: R2Bucket;
	MEDIA_PRIVATE?: R2Bucket;
}

/** What a call answers: a status and either its data or an error code (with detail, e.g. the missing files). */
export type PrebuiltOutcome =
	| { status: 200 | 201; data: Record<string, unknown> }
	| { status: 204 }
	| { status: 400 | 404 | 409 | 503; error: string; detail?: Record<string, unknown> };

const fail = (status: 400 | 404 | 409 | 503, error: string, detail?: Record<string, unknown>): PrebuiltOutcome => ({ status, error, ...(detail ? { detail } : {}) });

export interface StagePlan {
	rungs: string[];
	files: Array<{ path: string; bytes: number }>;
	encoder?: string;
}

async function setState(env: PrebuiltEnv, videoId: string, update: (current: PrebuiltUploadState | undefined) => PrebuiltUploadState | undefined | false): Promise<PrebuiltUploadState | undefined | false> {
	let out: PrebuiltUploadState | undefined | false = false;
	await new R2Repository<WithPrebuilt>(env.videos).updateObject(videoId, (video) => {
		const next = update(video.prebuilt);
		out = next;
		if (next === false) return false;
		if (next) video.prebuilt = next;
		else delete video.prebuilt;
		return true;
	});
	return out;
}

/** Declares the rungs and files; replaces an earlier unfinished staging of the video. */
export async function stageRenditions(env: PrebuiltEnv, video: WithPrebuilt, plan: StagePlan, actorId: string): Promise<PrebuiltOutcome> {
	const bucket = env.MEDIA_PRIVATE;
	if (!bucket) return fail(503, 'storage_unavailable');
	if (tooLate(video.r2)) return fail(409, 'too_late');
	const checked = checkPlan(plan);
	if (!checked.ok) {
		const failed = checked as Extract<typeof checked, { ok: false }>;
		return fail(400, failed.error, failed.detail ? { detail: failed.detail } : undefined);
	}
	const ok = checked as Extract<typeof checked, { ok: true }>;
	const videoId = video.id;
	const stagingId = newStagingId();
	const now = new Date().toISOString();
	const encoder = plan.encoder ? { encoder: plan.encoder } : {};
	const manifest: PrebuiltManifest = { v: 1, videoId, stagingId, rungs: ok.rungs, files: ok.files, createdAt: now, createdBy: actorId, ...encoder };
	await bucket.put(manifestKey(videoId, stagingId), JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
	const state: PrebuiltUploadState = { stagingId, status: 'uploading', rungs: ok.rungs, files: ok.files.length, bytes: ok.bytes, createdAt: now, ...encoder };
	let replaced: string | undefined;
	const written = await setState(env, videoId, (current) => {
		if (current && current.status === 'queued') return false;
		replaced = current?.stagingId;
		return state;
	});
	if (written === false) {
		await deleteStaging(bucket, videoId, stagingId);
		return fail(409, 'too_late');
	}
	if (replaced && replaced !== stagingId) await deleteStaging(bucket, videoId, replaced).catch(() => undefined);
	logger.info('[Renditions] Pre-encoded upload staged', { videoId, stagingId, rungs: ok.rungs.join(','), files: ok.files.length, bytes: ok.bytes, actorId });
	return { status: 201, data: { ...state, maxFileBytes: PREBUILT_LIMITS.maxFileBytes } };
}

/** The staging a request names, when it is still the video's current one. */
function currentStaging(env: PrebuiltEnv, video: WithPrebuilt, stagingId: string): { state: PrebuiltUploadState; bucket: R2Bucket } | { outcome: PrebuiltOutcome } {
	if (!isPrebuiltStagingId(stagingId) || video.prebuilt?.stagingId !== stagingId || isStale(video.prebuilt)) return { outcome: fail(404, 'staging_not_found') };
	if (!env.MEDIA_PRIVATE) return { outcome: fail(503, 'storage_unavailable') };
	return { state: video.prebuilt, bucket: env.MEDIA_PRIVATE };
}

/** One declared file, exactly its declared size; a second upload replaces it. */
export async function putRenditionFile(
	env: PrebuiltEnv,
	video: WithPrebuilt,
	file: { stagingId: string; rung: string; name: string; contentLength?: string | null; body: () => Promise<ArrayBuffer> },
): Promise<PrebuiltOutcome> {
	const found = currentStaging(env, video, file.stagingId);
	if ('outcome' in found) return found.outcome;
	if (found.state.status !== 'uploading') return fail(409, 'not_uploading');
	const manifest = await readManifest(found.bucket, video.id, file.stagingId);
	const path = `${file.rung}/${file.name}`;
	const declared = manifest?.files.find((f) => f.path === path);
	if (!declared) return fail(400, 'file_not_declared');
	const length = Number(file.contentLength);
	if (file.contentLength && Number.isFinite(length) && length !== declared.bytes) return fail(400, 'size_mismatch');
	const data = await file.body();
	if (data.byteLength !== declared.bytes) return fail(400, 'size_mismatch');
	await found.bucket.put(`${prebuiltStagingPrefix(video.id, file.stagingId)}${path}`, data);
	return { status: 204 };
}

/** Every declared file is there: the renditions wait for the original upload's transcode. */
export async function completeRenditions(env: PrebuiltEnv, video: WithPrebuilt, stagingId: string): Promise<PrebuiltOutcome> {
	const found = currentStaging(env, video, stagingId);
	if ('outcome' in found) return found.outcome;
	if (tooLate(video.r2)) return fail(409, 'too_late');
	if (found.state.status !== 'uploading') return { status: 200, data: { ...found.state } };
	const manifest = await readManifest(found.bucket, video.id, stagingId);
	if (!manifest) return fail(404, 'staging_not_found');
	const missing = missingFiles(manifest, await stagedSizes(found.bucket, video.id, stagingId));
	if (missing.length) return fail(409, 'files_missing', { missing });
	const state = await setState(env, video.id, (current) => (current?.stagingId === stagingId && current.status === 'uploading' ? { ...current, status: 'ready' } : false));
	if (state === false || !state) return fail(404, 'staging_not_found');
	logger.info('[Renditions] Pre-encoded upload ready', { videoId: video.id, stagingId });
	return { status: 200, data: { ...state } };
}

/** Drops the staged files; the server encodes the video itself. */
export async function cancelRenditions(env: PrebuiltEnv, video: WithPrebuilt, stagingId: string): Promise<PrebuiltOutcome> {
	const found = currentStaging(env, video, stagingId);
	if ('outcome' in found) return found.outcome;
	if (found.state.status === 'queued') return fail(409, 'too_late');
	const cleared = await setState(env, video.id, (current) => (current?.stagingId === stagingId && current.status !== 'queued' ? undefined : false));
	if (cleared === false) return fail(409, 'too_late');
	await deleteStaging(found.bucket, video.id, stagingId);
	return { status: 200, data: {} };
}
