/**
 * Scheduled community posts go live (issue #1218). A post created or rescheduled with `scheduledAt`
 * gets a marker object in the community_posts bucket:
 *
 *   scheduled-posts/<scheduledAt ISO>/<channelId>/<postId>
 *
 * Keys sort by time, so the every-minute cron (src/index.ts) lists the prefix in order and stops at the
 * first marker still in the future: one small list per minute, never a scan of the posts. A due post
 * that is still SCHEDULED for that very time is published (status, createdAt = its time, first in the
 * channel's index) and announced with CommunityPostCreated (notifications and the scholar reference
 * outbox). A marker whose post was deleted, published by hand or rescheduled is dropped.
 */
import { PostStatus, type CommunityPost } from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import Queue, { MessageType } from './queue';
import { logger } from './logger';

export const SCHEDULED_PREFIX = 'scheduled-posts/';
/** Markers handled per run; a backlog drains over the next minutes. */
export const SCHEDULED_BATCH = 50;

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function scheduleMarkerKey(scheduledAt: string, channelId: string, postId: string): string | null {
	const t = Date.parse(scheduledAt);
	if (Number.isNaN(t) || !ID.test(channelId) || !ID.test(postId)) return null;
	return `${SCHEDULED_PREFIX}${new Date(t).toISOString()}/${channelId}/${postId}`;
}

export function parseMarkerKey(key: string): { at: string; channelId: string; postId: string } | null {
	const m = /^scheduled-posts\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/.exec(key);
	return m ? { at: m[1], channelId: m[2], postId: m[3] } : null;
}

/** Records that a post goes live at `scheduledAt` (create and reschedule). */
export async function markScheduled(bucket: R2Bucket, channelId: string, postId: string, scheduledAt: string): Promise<void> {
	const key = scheduleMarkerKey(scheduledAt, channelId, postId);
	if (key) await bucket.put(key, '', { httpMetadata: { contentType: 'text/plain' } });
}

/** Whether a post is waiting for its time (hidden from everyone but its channel until then). */
export function isUpcoming(post: Pick<CommunityPost, 'status' | 'scheduledAt'>, now = Date.now()): boolean {
	if (post.status !== PostStatus.SCHEDULED) return false;
	const t = post.scheduledAt ? Date.parse(post.scheduledAt) : Number.NaN;
	return Number.isNaN(t) || t > now;
}

export interface ScheduledEnv {
	community_posts: R2Bucket;
	queue?: unknown;
}

export async function publishDuePosts(env: ScheduledEnv, now = new Date()): Promise<{ published: number; dropped: number }> {
	const listed = await env.community_posts.list({ prefix: SCHEDULED_PREFIX, limit: SCHEDULED_BATCH });
	const out = { published: 0, dropped: 0 };
	const nowIso = now.toISOString();
	for (const obj of listed.objects) {
		const m = parseMarkerKey(obj.key);
		if (!m) {
			await env.community_posts.delete(obj.key);
			out.dropped++;
			continue;
		}
		if (m.at > nowIso) break; // sorted: everything after is later
		const saved = await goLive(env, m.channelId, m.postId, m.at, m.at, nowIso);
		if (saved) {
			out.published++;
			logger.info('[ScheduledPosts] published', { channelId: m.channelId, postId: m.postId });
		} else {
			out.dropped++;
		}
		await env.community_posts.delete(obj.key);
	}
	return out;
}

/**
 * A scheduled post goes live at `at`: status published, createdAt = `at`, first in the channel's
 * index, and CommunityPostCreated (the processor notifies subscribers and syncs the scholar
 * reference). `expectAt` = only while it is still scheduled for that time (the cron; a post
 * rescheduled since keeps waiting); null = whatever its time (Publish now). Null when nothing changed.
 */
export async function goLive(
	env: ScheduledEnv,
	channelId: string,
	postId: string,
	expectAt: string | null,
	at: string,
	nowIso = new Date().toISOString(),
	actor?: { userId: string; channelId?: string },
): Promise<CommunityPost | null> {
	const key = `posts/${channelId}/${postId}.json`;
	let went = false;
	const saved = await new R2Repository<CommunityPost>(env.community_posts).updateObject(key, (p) => {
		if (p.status !== PostStatus.SCHEDULED) return false;
		if (expectAt !== null) {
			const t = p.scheduledAt ? Date.parse(p.scheduledAt) : Number.NaN;
			if (Number.isNaN(t) || new Date(t).toISOString() !== expectAt) return false;
		}
		p.status = PostStatus.PUBLISHED;
		p.createdAt = at;
		p.updatedAt = nowIso;
		went = true;
		return true;
	});
	if (!saved || !went) return null;
	type PostIndex = { postIds: string[]; lastUpdated: string };
	await new R2Repository<PostIndex>(env.community_posts).updateObject(
		`posts/${channelId}/index.json`,
		(index) => {
			index.postIds = [postId, ...index.postIds.filter((id) => id !== postId)].slice(0, 1000);
			index.lastUpdated = nowIso;
		},
		{ initial: () => ({ postIds: [], lastUpdated: nowIso }) },
	);
	if (env.queue) {
		await new Queue(env.queue as never).send(MessageType.CommunityPostCreated, {
			postId,
			channelId,
			actor: actor ?? { userId: saved.userId, channelId },
			timestamp: at,
		});
	}
	return saved;
}
