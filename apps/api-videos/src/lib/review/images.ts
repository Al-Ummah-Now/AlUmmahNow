/**
 * Image review (VR16; docs/specs/VIDEO-REVIEW.md §8): community post images, channel avatars and
 * banners, profile pictures and banners.
 *
 * - A post with images is created held (review.status checking) and withheld from everyone but
 *   its author; an NSFW hit holds the WHOLE post for a person. When it clears, the post is
 *   published and its subscribers are told (the notice waits for the check).
 * - An avatar or banner has no post to hold: the new image waits in `pendingImages[field]` and
 *   everyone else keeps seeing the previous (or default) image until it is clean.
 *
 * Mode off, or outside production: nothing changes (images apply at once, as before).
 */
import {
  IMAGE_SUBJECT_FIELD,
  MessageType,
  effectiveReviewMode,
  holdsWhileChecking,
  readVideoReviewSettings,
  scansInMode,
  type ImageReviewResultRequest,
  type ImageReviewScanPayload,
  type ImageReviewSubject,
  type PendingImage,
  type ReviewSettingsBucket,
  type VideoReviewMode,
  type VideoReviewSettings,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import Queue from '../queue';
import { logger } from '../logger';
import { enqueueNotification, type NotificationsEnv } from '../notifications';

export interface ImageReviewEnv extends NotificationsEnv {
	global_settings?: unknown;
	MODERATION_QUEUE?: { send(message: unknown): Promise<unknown> };
	VIDEO_REVIEW_ALLOWED?: string;
	channels?: R2Bucket;
	profiles?: R2Bucket;
	community_posts?: R2Bucket;
}

export interface ImageGate {
	mode: VideoReviewMode;
	settings: VideoReviewSettings;
	/** True when the image (or post) must wait for the check */
	holds: boolean;
	/** True when a scan is queued at all (shadow included) */
	scans: boolean;
}

export async function imageGate(env: ImageReviewEnv): Promise<ImageGate> {
	const settings = await readVideoReviewSettings(env.global_settings as ReviewSettingsBucket | undefined);
	const mode = effectiveReviewMode(settings, env.VIDEO_REVIEW_ALLOWED);
	return { mode, settings, holds: holdsWhileChecking(mode), scans: scansInMode(mode) };
}

/** Never throws: an image whose scan cannot be queued stays pending (fail safe), and is logged. */
export async function queueImageScan(env: ImageReviewEnv, gate: ImageGate, input: Omit<ImageReviewScanPayload, 'mode' | 'settings' | 'queuedAt'>): Promise<boolean> {
	if (!gate.scans || !env.MODERATION_QUEUE) return false;
	const payload: ImageReviewScanPayload = { ...input, mode: gate.mode as ImageReviewScanPayload['mode'], settings: gate.settings, queuedAt: new Date().toISOString() };
	try {
		await env.MODERATION_QUEUE.send({ id: crypto.randomUUID(), type: MessageType.ImageReviewScan, payload, timestamp: Date.now() });
		return true;
	} catch (error) {
		logger.error('[Review] Image scan not queued; the image stays pending', { subject: input.subject, subjectId: input.subjectId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/**
 * The patch for a new channel/profile image: the field itself (not gated), or a pending entry.
 * `current` is the stored record's pendingImages, so another field's pending image is kept.
 */
export function newImagePatch(
	gate: ImageGate,
	subject: Exclude<ImageReviewSubject, 'post'>,
	url: string,
	current: Record<string, PendingImage> | undefined,
	reviewId = crypto.randomUUID(),
): { patch: Record<string, unknown>; reviewId: string | null } {
	const field = IMAGE_SUBJECT_FIELD[subject];
	if (!gate.holds) return { patch: { [field]: url }, reviewId: gate.scans ? reviewId : null };
	const pending: PendingImage = { url, reviewId, since: new Date().toISOString(), status: 'checking' };
	return { patch: { pendingImages: { ...(current ?? {}), [field]: pending } }, reviewId };
}

// ---------- applying results ----------

export type ImageApply = { applied: true } | { applied: false; status: 400 | 404 | 409; why: string };

async function updateRecord(bucket: R2Bucket | undefined, id: string, mutate: (r: Record<string, any>) => boolean | 'refuse'): Promise<ImageApply> {
	if (!bucket) return { applied: false, status: 404, why: 'store not bound' };
	let refused = false;
	const saved = await new R2Repository<Record<string, any>>(bucket).updateObject(id, (r) => {
		const v = mutate(r);
		if (v === 'refuse') {
			refused = true;
			return false;
		}
		return v;
	});
	if (!saved) return { applied: false, status: 404, why: 'not found' };
	if (refused) return { applied: false, status: 409, why: 'not the current review' };
	return { applied: true };
}

/** A channel/profile image: approve swaps it in, hold keeps it pending for a person, reject drops it. */
async function applyToPendingImage(env: ImageReviewEnv, req: ImageReviewResultRequest): Promise<ImageApply> {
	const subject = req.subject as Exclude<ImageReviewSubject, 'post'>;
	const field = IMAGE_SUBJECT_FIELD[subject];
	const bucket = subject === 'avatar' || subject === 'banner' ? env.channels : env.profiles;
	return updateRecord(bucket, req.subjectId, (r) => {
		const pending = r.pendingImages?.[field] as PendingImage | undefined;
		if (!pending || pending.reviewId !== req.reviewId) return 'refuse';
		if (req.result === 'approve') {
			r[field] = pending.url;
			delete r.pendingImages[field];
		} else if (req.result === 'hold') {
			pending.status = 'in_review';
		} else {
			delete r.pendingImages[field];
		}
		if (r.pendingImages && Object.keys(r.pendingImages).length === 0) delete r.pendingImages;
		return true;
	});
}

/** A post: approve publishes it (and its subscribers are told), hold waits for a person, reject keeps it from everyone else. */
async function applyToPost(env: ImageReviewEnv, req: ImageReviewResultRequest): Promise<ImageApply> {
	const [channelId, postId] = req.subjectId.split('/');
	if (!channelId || !postId) return { applied: false, status: 400, why: 'subjectId must be <channelId>/<postId>' };
	let publish = false;
	let post: Record<string, any> | null = null;
	const result = await updateRecord(env.community_posts, `posts/${channelId}/${postId}.json`, (p) => {
		if (!p.review || p.review.reviewId !== req.reviewId) return 'refuse';
		const was = p.review.status;
		const now = new Date().toISOString();
		if (req.result === 'approve') {
			p.review = { ...p.review, status: 'approved', since: now, ...(req.reviewerId ? { decidedAt: now } : {}) };
			publish = was !== 'approved';
		} else if (req.result === 'hold') {
			if (was === 'checking') p.review = { ...p.review, status: 'in_review', since: now };
		} else {
			p.review = { ...p.review, status: 'rejected', since: now, decidedAt: now, ...(req.reasonCode ? { reasonCode: req.reasonCode } : {}) };
		}
		post = p;
		return true;
	});
	if (!result.applied || !post) return result;
	const p = post as Record<string, any>;
	if (publish && p.status === 'published') {
		// The notice to subscribers waited for the check (create-post)
		await new Queue(env.queue as never).send(MessageType.CommunityPostCreated, { postId, channelId, actor: { userId: p.userId, channelId }, timestamp: p.createdAt }).catch(() => undefined);
	}
	if (req.reviewerId && p.userId && req.result !== 'hold') {
		await enqueueNotification(env, {
			notificationId: crypto.randomUUID(),
			recipientUserId: p.userId,
			notificationKey: req.result === 'approve' ? 'reviewApproved' : 'reviewRejected',
			params: { videoTitle: String(p.title ?? p.content ?? '').slice(0, 80), ...(req.result === 'reject' ? { reason: req.reasonCode ?? 'other' } : {}) },
			actionUrl: `/channel/${channelId}/community`,
			entityId: postId,
			dedupeKey: `review:${req.reviewId}:${req.result}`,
			createdAt: Date.now(),
		});
	}
	return result;
}

export async function applyImageResult(env: ImageReviewEnv, req: ImageReviewResultRequest): Promise<ImageApply> {
	const res = req.subject === 'post' ? await applyToPost(env, req) : await applyToPendingImage(env, req);
	if (res.applied) logger.info('[Review] Image result applied', { subject: req.subject, subjectId: req.subjectId, result: req.result, by: req.reviewerId ? 'reviewer' : 'automated' });
	return res;
}
