/**
 * Claiming the video review's transcript as a caption draft (VR11, #1296). The work is a queued
 * processor job (captions/claim.ts there); this side checks, records the claim and queues it.
 */
import { MessageType, captionClaimKey, captionClaimsPrefix, type CaptionClaimPayload, type CaptionClaimState } from '@al-ummah/shared-types';

type Bucket = any;

/** A claim queued this long ago without an outcome is stale (the job retries for ~15 minutes). */
const PENDING_MS = 30 * 60_000;

/** The review transcript of a video, if the review media still hold one. */
export function reviewTranscriptKey(video: { review?: { manifestKey?: string } | null; r2?: { result?: { review?: { manifestKey?: string } | null } | null } | null }): string | null {
	// The review state names the manifest; the transcoder's own result holds it too (a review not yet queued)
	const manifest = video.review?.manifestKey ?? video.r2?.result?.review?.manifestKey;
	return manifest && /^review\/.+manifest\.json$/.test(manifest) ? manifest.replace(/manifest\.json$/, 'transcript.json') : null;
}

export async function transcriptAvailable(mediaPrivate: Bucket | undefined, key: string | null): Promise<boolean> {
	if (!key || !mediaPrivate) return false;
	return !!(await (mediaPrivate.head ? mediaPrivate.head(key) : mediaPrivate.get(key)));
}

export async function listClaims(bucket: Bucket, videoId: string, now = Date.now()): Promise<CaptionClaimState[]> {
	const page = await bucket.list({ prefix: captionClaimsPrefix(videoId), limit: 50 });
	const states = await Promise.all(page.objects.map(async (o: { key: string }) => ((await bucket.get(o.key)) as { json(): Promise<CaptionClaimState> } | null)?.json()));
	return states.filter((s): s is CaptionClaimState => !!s && (s.status === 'failed' || now - Date.parse(s.requestedAt) < PENDING_MS));
}

export type ClaimOutcome = { status: 'queued' } | { status: 'pending' } | { status: 'draft_exists' };

export async function queueClaim(
	env: { subtitles: Bucket; queue: { send(m: unknown): Promise<unknown> } },
	p: Omit<CaptionClaimPayload, 'requestedAt'>,
	draftExists: boolean,
	now = new Date(),
): Promise<ClaimOutcome> {
	if (draftExists && !p.replace) return { status: 'draft_exists' };
	const key = captionClaimKey(p.videoId, p.language);
	const current = (await (await env.subtitles.get(key))?.json()) as CaptionClaimState | undefined;
	if (current?.status === 'queued' && now.getTime() - Date.parse(current.requestedAt) < PENDING_MS) return { status: 'pending' };
	const requestedAt = now.toISOString();
	const state: CaptionClaimState = { language: p.language, status: 'queued', requestedAt, requestedBy: p.requestedBy };
	await env.subtitles.put(key, JSON.stringify(state), { httpMetadata: { contentType: 'application/json' } });
	try {
		await env.queue.send({ id: crypto.randomUUID(), type: MessageType.CaptionClaimTranscript, payload: { ...p, requestedAt } satisfies CaptionClaimPayload, timestamp: now.getTime() });
	} catch (error) {
		await env.subtitles.delete(key);
		throw error;
	}
	return { status: 'queued' };
}
