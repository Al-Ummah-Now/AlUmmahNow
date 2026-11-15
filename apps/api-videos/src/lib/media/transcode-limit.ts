/**
 * Concurrent R2 transcodes as an autoscaling min–max range (videos admin → Video providers →
 * Cloudflare R2 settings; shared-types transcode-limit.ts), stored at
 * global_settings/ops/media-transcode-limit.json under the container ceiling MEDIA_TRANSCODE_CEILING.
 * apps/media's dispatcher reads the same object (its own 30 s cache) and enforces it. Writes come
 * only from admin-api (admin only, audited as media:transcode-limit).
 */
import {
	parseTranscodeLimitDoc,
	effectiveTranscodeRange,
	transcodeCeilingOf,
	transcodeRangeProblem,
	transcodeLimitView,
	TRANSCODE_LIMIT_CACHE_MS,
	TRANSCODE_LIMIT_KEY,
	type TranscodeLimitDoc,
	type TranscodeLimitField,
	type TranscodeLimitProblem,
	type TranscodeLimitView,
	type TranscodeRange,
} from '@al-ummah/shared-types';
import { logger } from '../logger';

export type TranscodeLimitEnv = { global_settings?: R2Bucket; MEDIA_TRANSCODE_CEILING?: string };

let cache: { at: number; doc: TranscodeLimitDoc | null } | null = null;

export function clearTranscodeLimitCache(): void {
	cache = null;
}

export class TranscodeLimitError extends Error {
	constructor(readonly problem: TranscodeLimitProblem, readonly field: TranscodeLimitField, readonly ceiling: number | null) {
		super(`Transcode limit refused: ${problem}`);
		this.name = 'TranscodeLimitError';
	}
}

async function readDoc(env: TranscodeLimitEnv, fresh: boolean, now: number): Promise<TranscodeLimitDoc | null> {
	if (!fresh && cache && now - cache.at < TRANSCODE_LIMIT_CACHE_MS) return cache.doc;
	let doc: TranscodeLimitDoc | null = null;
	try {
		const obj = await env.global_settings?.get(TRANSCODE_LIMIT_KEY);
		if (obj) doc = parseTranscodeLimitDoc(await obj.json());
	} catch (error) {
		logger.warn('[Media] Could not read the transcode limit; using the default', { error: error instanceof Error ? error.message : String(error) });
	}
	cache = { at: now, doc };
	return doc;
}

export async function readTranscodeLimitView(env: TranscodeLimitEnv, fresh = false, now = Date.now()): Promise<TranscodeLimitView> {
	return transcodeLimitView(await readDoc(env, fresh, now), transcodeCeilingOf(env.MEDIA_TRANSCODE_CEILING));
}

/** The range the dispatcher enforces now (the setting under the ceiling). */
export async function effectiveTranscodes(env: TranscodeLimitEnv, now = Date.now()): Promise<TranscodeRange> {
	return effectiveTranscodeRange(await readDoc(env, false, now), transcodeCeilingOf(env.MEDIA_TRANSCODE_CEILING));
}

/** Save the admin's range (1 ≤ min ≤ max ≤ ceiling); TranscodeLimitError when it isn't. */
export async function saveTranscodeLimit(env: TranscodeLimitEnv, range: { min?: unknown; max?: unknown }, actorId: string, now = Date.now()): Promise<TranscodeLimitView> {
	if (!env.global_settings) throw new Error('global_settings is not bound');
	const ceiling = transcodeCeilingOf(env.MEDIA_TRANSCODE_CEILING);
	const problem = transcodeRangeProblem(range.min, range.max, ceiling);
	if (problem) throw new TranscodeLimitError(problem.problem, problem.field, ceiling);
	const doc: TranscodeLimitDoc = { min: range.min as number, max: range.max as number, updatedAt: new Date(now).toISOString(), updatedBy: actorId };
	await env.global_settings.put(TRANSCODE_LIMIT_KEY, JSON.stringify(doc), { httpMetadata: { contentType: 'application/json' } });
	cache = { at: now, doc };
	logger.warn('[Media] Concurrent transcodes range changed', { actorId, min: doc.min, max: doc.max, ceiling });
	return transcodeLimitView(doc, ceiling);
}
