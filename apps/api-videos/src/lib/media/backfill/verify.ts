/**
 * Verify a video's R2 copy before it counts as R2-ready (and before Bunny may ever be removed):
 *   original    our original's manifest exists, its size is the copied size, every copied range's
 *               MD5 matched R2's at copy time (or, for a kept upload, its parts cover the file)
 *   renditions  the rendition is ready, the master lists every rung, no rung is above the source
 *   duration    the rendition's duration matches Bunny's (max(2 s, 1%)); without a Bunny copy, the record's
 *   objects     every playlist, init segment and media segment the playlists name exists and is not empty
 * The result is stored per video in media_r2_verified with the rendition's rev: a later re-transcode
 * (new rev) makes it stale.
 */
import {
	durationMatches,
	MEDIA_MASTER,
	MEDIA_THUMBNAIL,
	originalManifestKey,
	originalPrefix,
	partsCover,
	partsFromKeys,
	playlistUris,
	resolveKey,
	type BackfillChecks,
	type OriginalManifest,
	type VideoR2State,
} from '@al-ummah/shared-types';
import R2Repository from '../../r2Repo';
import type { LibraryHints } from '../../bunny/libraries';
import { bunnyRef } from '../providers';
import { bunnyFacts } from './source';
import type { ItemRow } from './store';
import type { BackfillEnv } from './types';

interface VerifyVideo extends LibraryHints {
	id: string;
	duration?: number;
	isDeleted?: boolean;
	r2?: VideoR2State;
	media?: unknown;
	bunnyRemoved?: unknown;
}

async function listAll(bucket: R2Bucket, prefix: string): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		for (const o of page.objects) out.set(o.key, o.size);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

export async function checkOriginal(env: BackfillEnv, item: Pick<ItemRow, 'video_id' | 'source_bytes' | 'parts' | 'upload_id'>): Promise<BackfillChecks['original']> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) return { ok: false, detail: 'originals bucket not bound' };
	const obj = await bucket.get(originalManifestKey(item.video_id));
	if (!obj) return { ok: false, detail: 'no manifest' };
	const manifest = (await obj.json()) as OriginalManifest;
	const objects = [...(await listAll(bucket, originalPrefix(item.video_id))).entries()].map(([key, size]) => ({ key, size }));
	const parts = partsFromKeys(objects, item.video_id, manifest.uploadId);
	if (!partsCover(parts, manifest.size).complete) return { ok: false, bytes: manifest.size, parts: parts.length, detail: 'parts do not cover the file' };
	// Our own copy: the size is Bunny's and every range's MD5 was checked against R2's when it was written
	if (item.upload_id && manifest.uploadId === item.upload_id) {
		if (item.source_bytes && manifest.size !== item.source_bytes) return { ok: false, bytes: manifest.size, detail: `size ${manifest.size} ≠ Bunny's ${item.source_bytes}` };
		const sums = item.parts ? (JSON.parse(item.parts) as Record<string, string>) : {};
		const unchecked = parts.filter((p) => !sums[String(p.offset)]);
		if (unchecked.length) return { ok: false, bytes: manifest.size, parts: parts.length, detail: `${unchecked.length} parts without a checksum` };
	}
	return { ok: true, bytes: manifest.size, parts: parts.length };
}

/** Every key the playlists of a rendition name, checked against what R2 holds. */
export async function checkObjects(bucket: R2Bucket, prefix: string): Promise<{ objects: BackfillChecks['objects']; rungs: string[] }> {
	const listed = await listAll(bucket, prefix);
	const masterKey = `${prefix}${MEDIA_MASTER}`;
	const master = await bucket.get(masterKey);
	if (!master) return { objects: { ok: false, checked: 0, missing: 1, detail: 'no master playlist' }, rungs: [] };
	const variants = playlistUris(await master.text()).map((u) => resolveKey(masterKey, u));
	let checked = 1;
	const missing: string[] = [];
	const rungs: string[] = [];
	for (const variantKey of variants) {
		checked++;
		const variant = await bucket.get(variantKey);
		if (!variant) {
			missing.push(variantKey);
			continue;
		}
		rungs.push(variantKey.slice(prefix.length).split('/')[0]!.replace(/\.m3u8$/, ''));
		for (const uri of playlistUris(await variant.text())) {
			checked++;
			const key = resolveKey(variantKey, uri);
			if (!((listed.get(key) ?? 0) > 0)) missing.push(key);
		}
	}
	if (!((listed.get(`${prefix}${MEDIA_THUMBNAIL}`) ?? 0) > 0)) missing.push(`${prefix}${MEDIA_THUMBNAIL}`);
	const detail = missing.length ? `missing: ${missing.slice(0, 3).map((k) => k.slice(prefix.length)).join(', ')}${missing.length > 3 ? ` (+${missing.length - 3})` : ''}` : undefined;
	return { objects: { ok: variants.length > 0 && missing.length === 0, checked, missing: missing.length, ...(detail ? { detail } : {}) }, rungs };
}

export async function verifyItem(env: BackfillEnv, item: ItemRow): Promise<{ ok: boolean; checks: BackfillChecks; rev?: string; error?: string }> {
	const video = await new R2Repository<VerifyVideo>(env.videos).getObject(item.video_id);
	const empty: BackfillChecks = { original: { ok: false }, renditions: { ok: false }, duration: { ok: false }, objects: { ok: false } };
	if (!video || video.isDeleted) return { ok: false, checks: empty, error: 'The video was deleted' };
	const r2 = video.r2;
	const result = r2?.status === 'ready' ? r2.result : undefined;
	const original = await checkOriginal(env, item);
	if (!r2 || !result) return { ok: false, checks: { ...empty, original }, error: `The R2 rendition is ${r2?.status ?? 'missing'}` };
	const bucket = r2.access === 'pub' ? env.MEDIA : env.MEDIA_PRIVATE;
	if (!bucket) return { ok: false, checks: { ...empty, original }, error: 'media bucket not bound' };
	const prefix = `${r2.access}/${item.video_id}/${r2.rev}/`;
	const { objects, rungs } = await checkObjects(bucket, prefix);
	const sourceHeight = result.source?.height ?? 0;
	const tooHigh = result.rungs.filter((r) => sourceHeight > 0 && r.height > sourceHeight + 8).map((r) => r.name);
	const listed = new Set(rungs);
	const unlisted = result.rungs.map((r) => r.name).filter((n) => !listed.has(n));
	const renditions: BackfillChecks['renditions'] = {
		ok: result.rungs.length > 0 && !tooHigh.length && !unlisted.length,
		rungs: result.rungs.map((r) => r.name),
		...(tooHigh.length ? { detail: `above the source: ${tooHigh.join(', ')}` } : unlisted.length ? { detail: `not in the master playlist: ${unlisted.join(', ')}` } : {}),
	};
	const guid = bunnyRef({ ...video, id: item.video_id } as never);
	const facts = guid ? await bunnyFacts(env, guid, video).catch(() => null) : null;
	const reference = facts?.lengthSeconds ?? video.duration ?? item.duration_seconds ?? 0;
	const r2Seconds = result.durationSeconds || result.source?.durationSeconds || 0;
	const duration: BackfillChecks['duration'] = {
		ok: durationMatches(r2Seconds, reference),
		r2Seconds: Math.round(r2Seconds * 10) / 10,
		bunnySeconds: Math.round(reference * 10) / 10,
		...(reference > 0 ? {} : { detail: 'no reference duration' }),
	};
	const checks: BackfillChecks = { original, renditions, duration, objects, rev: r2.rev, access: r2.access };
	const ok = original.ok && renditions.ok && duration.ok && objects.ok;
	const failed = (['original', 'renditions', 'duration', 'objects'] as const).filter((k) => !checks[k].ok);
	return { ok, checks, rev: r2.rev, ...(ok ? {} : { error: `Verification failed: ${failed.map((k) => `${k}${checks[k].detail ? ` (${checks[k].detail})` : ''}`).join('; ')}` }) };
}
