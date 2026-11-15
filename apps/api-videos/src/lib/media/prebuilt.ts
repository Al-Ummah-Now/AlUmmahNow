/**
 * D11: renditions the creator encoded in desktop Studio (optional pre-encode).
 *
 * Studio declares the files, PUTs each one into a staging prefix of MEDIA_PRIVATE, then completes.
 * The transcode job queued when the original upload completes carries the staging reference; the
 * media container verifies every rung against the ladder it would have encoded and either uses them
 * or encodes as usual (apps/media/container/prebuilt.mjs). The server never trusts the files: it
 * writes its own master playlist and the staging prefix is deleted when the job ends.
 */
import {
	PREBUILT_LIMITS,
	PREBUILT_RUNG_NAMES,
	isPrebuiltStagingId,
	newMediaRev,
	prebuiltStagingPrefix,
	type PrebuiltUploadState,
	type VideoR2State,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';

type Bucket = any;

export interface PrebuiltFile {
	path: string;
	bytes: number;
}

export interface PrebuiltManifest {
	v: 1;
	videoId: string;
	stagingId: string;
	rungs: string[];
	files: PrebuiltFile[];
	createdAt: string;
	createdBy: string;
	encoder?: string;
}

const FILE = /^([A-Za-z0-9_-]{1,16})\/([A-Za-z0-9._-]{1,64})$/;
const ENCODER = /^[\p{L}\p{N} ()+._-]{1,60}$/u;

export const manifestKey = (videoId: string, stagingId: string) => `${prebuiltStagingPrefix(videoId, stagingId)}_manifest.json`;

export type PlanCheck = { ok: true; rungs: string[]; files: PrebuiltFile[]; bytes: number } | { ok: false; error: string; detail?: string };

/** Checks what Studio declares: known rung names, every rung with a playlist, safe paths, sizes in bounds. */
export function checkPlan(input: { rungs: unknown; files: unknown; encoder?: unknown }): PlanCheck {
	if (!Array.isArray(input.rungs) || input.rungs.length === 0) return { ok: false, error: 'invalid_rungs' };
	const rungs = [...new Set(input.rungs as unknown[])];
	if (rungs.length !== input.rungs.length || !rungs.every((r) => typeof r === 'string' && (PREBUILT_RUNG_NAMES as readonly string[]).includes(r))) return { ok: false, error: 'invalid_rungs' };
	if (input.encoder !== undefined && (typeof input.encoder !== 'string' || !ENCODER.test(input.encoder))) return { ok: false, error: 'invalid_encoder' };
	if (!Array.isArray(input.files) || input.files.length === 0) return { ok: false, error: 'invalid_files' };
	if (input.files.length > PREBUILT_LIMITS.maxFiles) return { ok: false, error: 'too_many_files' };
	const seen = new Set<string>();
	const files: PrebuiltFile[] = [];
	let bytes = 0;
	for (const f of input.files as Array<{ path?: unknown; bytes?: unknown }>) {
		const path = typeof f?.path === 'string' ? f.path : '';
		const m = FILE.exec(path);
		if (!m || m[2] === '.' || m[2] === '..' || !rungs.includes(m[1]!) || seen.has(path)) return { ok: false, error: 'invalid_files', detail: path.slice(0, 80) };
		const size = typeof f.bytes === 'number' && Number.isInteger(f.bytes) ? f.bytes : -1;
		if (size <= 0 || size > PREBUILT_LIMITS.maxFileBytes) return { ok: false, error: 'invalid_files', detail: path };
		seen.add(path);
		bytes += size;
		files.push({ path, bytes: size });
	}
	if (bytes > PREBUILT_LIMITS.maxTotalBytes) return { ok: false, error: 'too_large' };
	for (const r of rungs as string[]) if (!seen.has(`${r}/index.m3u8`)) return { ok: false, error: 'invalid_files', detail: `${r}/index.m3u8` };
	return { ok: true, rungs: rungs as string[], files, bytes };
}

/** Pre-encoded renditions are useful only before the server starts its own transcode. */
export function tooLate(r2: VideoR2State | undefined): boolean {
	return !!r2 && (r2.status === 'queued' || r2.status === 'transcoding' || r2.status === 'ready');
}

/** A staged upload left unfinished or unused too long is gone (lib/uploads/reaper.ts deletes its files). */
export function isStale(state: PrebuiltUploadState | undefined, now = Date.now()): boolean {
	return !!state && now - Date.parse(state.createdAt) > PREBUILT_LIMITS.staleAfterMs;
}

export function newStagingId(): string {
	return newMediaRev();
}

export async function readManifest(bucket: Bucket, videoId: string, stagingId: string): Promise<PrebuiltManifest | null> {
	if (!isPrebuiltStagingId(stagingId)) return null;
	const obj = await bucket.get(manifestKey(videoId, stagingId));
	return obj ? ((await obj.json()) as PrebuiltManifest) : null;
}

/** Sizes of every staged file, from listings (no per-file HEAD). */
export async function stagedSizes(bucket: Bucket, videoId: string, stagingId: string): Promise<Map<string, number>> {
	const prefix = prebuiltStagingPrefix(videoId, stagingId);
	const sizes = new Map<string, number>();
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		for (const o of page.objects as Array<{ key: string; size: number }>) sizes.set(o.key.slice(prefix.length), o.size);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return sizes;
}

/** Files declared but not (fully) uploaded yet, first 50. */
export function missingFiles(manifest: PrebuiltManifest, sizes: Map<string, number>): string[] {
	return manifest.files.filter((f) => sizes.get(f.path) !== f.bytes).slice(0, 50).map((f) => f.path);
}

export async function deleteStaging(bucket: Bucket, videoId: string, stagingId: string): Promise<number> {
	const prefix = prebuiltStagingPrefix(videoId, stagingId);
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		const keys = (page.objects as Array<{ key: string }>).map((o) => o.key);
		if (keys.length) await bucket.delete(keys);
		deleted += keys.length;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return deleted;
}

/** A staging prefix whose job never ran (queue lost, video deleted) is dropped after this long. */
export const ORPHAN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hourly: staged pre-encoded uploads that were never finished or never used are deleted. A staged
 * upload the video still points at survives until it is stale (48 h, or 7 days once handed to a job,
 * whose own end normally deletes it). Bounded per run; the next hour carries on.
 */
export async function sweepStaging(env: { MEDIA_PRIVATE?: Bucket; videos: Bucket }, now = Date.now(), maxPrefixes = 200): Promise<{ checked: number; deleted: number }> {
	if (!env.MEDIA_PRIVATE) return { checked: 0, deleted: 0 };
	let checked = 0;
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const page = await env.MEDIA_PRIVATE.list({ prefix: 'staging/', cursor, limit: 1000 });
		for (const o of page.objects as Array<{ key: string; uploaded: Date }>) {
			const m = /^staging\/([A-Za-z0-9-]{8,64})\/([a-f0-9]{16})\/_manifest\.json$/.exec(o.key);
			if (!m) continue;
			if (++checked > maxPrefixes) return { checked: checked - 1, deleted };
			const age = now - new Date(o.uploaded).getTime();
			if (age < PREBUILT_LIMITS.staleAfterMs) continue;
			const video = (await (await env.videos.get(m[1]))?.json()) as { prebuilt?: PrebuiltUploadState } | null;
			const current = video?.prebuilt?.stagingId === m[2];
			const keep = current && (video!.prebuilt!.status === 'queued' ? age < ORPHAN_AFTER_MS : !isStale(video!.prebuilt, now));
			if (keep) continue;
			deleted += await deleteStaging(env.MEDIA_PRIVATE, m[1]!, m[2]!);
			if (current) {
				await new R2Repository<{ prebuilt?: PrebuiltUploadState }>(env.videos).updateObject(m[1]!, (v) => {
					if (v.prebuilt?.stagingId !== m[2]) return false;
					delete v.prebuilt;
					return true;
				});
			}
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return { checked, deleted };
}
