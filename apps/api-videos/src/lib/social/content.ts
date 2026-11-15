/**
 * What a social post or webhook says about an event: the public facts of a video, Short, live stream or
 * community post, read at send time (so an edit before the post goes out is honoured, and something made
 * private meanwhile is never announced).
 */
import {
	PostStatus,
	PostVisibility,
	isPostHeldByReview,
	isShort,
	isVideoPubliclyVisible,
	localizedChannelNames,
	shortLinkOriginFor,
	shortLinkUrl,
	type CommunityPost,
	type SocialEvent,
	type SocialLanguage,
	type SocialWebhookPayload,
	type VideoObject,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { isUpcoming } from '../scheduled-posts';
import { readStream, type StreamsEnv } from '../live/streams';
import { loadPublicPlay, type PublicPlayEnv } from '../media/public-play';
import { logger } from '../logger';

export interface SocialContentEnv {
	videos: R2Bucket;
	channels: R2Bucket;
	community_posts?: R2Bucket;
	VIDEOS_WEB_URL?: string;
}

interface ChannelRecord {
	id: string;
	name?: string;
	nameLocalized?: Record<string, string>;
	handle?: string;
	isDeleted?: boolean;
	isHidden?: boolean;
	isPrivate?: boolean;
	isSuspended?: boolean;
}

export interface SocialContent {
	event: SocialEvent;
	entityId: string;
	channelId: string;
	channel: { id: string; name: Record<SocialLanguage, string>; handle?: string; url: string };
	title: Record<SocialLanguage, string>;
	/** Community post text */
	text?: string;
	/** The page, per language (a short link where the environment has one: it counts clicks) */
	url: Record<SocialLanguage, string>;
	canonicalUrl: Record<SocialLanguage, string>;
	thumbnailUrl?: string;
	video?: { url: string; durationSeconds: number; width: number | null; height: number | null };
	durationSeconds?: number;
	publishedAt?: string;
}

export function webOrigin(env: Pick<SocialContentEnv, 'VIDEOS_WEB_URL'>): string {
	return (env.VIDEOS_WEB_URL || 'https://videos.alummahnow.net').replace(/\/+$/, '');
}

const both = (en: string, ar?: string | null): Record<SocialLanguage, string> => ({ en, ar: ar || en });

async function readChannel(env: SocialContentEnv, channelId: string): Promise<ChannelRecord | null> {
	const channel = await new R2Repository<ChannelRecord>(env.channels).getObject(channelId);
	if (!channel || channel.isDeleted || channel.isHidden || channel.isPrivate || channel.isSuspended) return null;
	return { ...channel, id: channelId };
}

function channelPart(env: SocialContentEnv, channel: ChannelRecord) {
	const names = localizedChannelNames(channel as never);
	const name = channel.name?.trim() || names.en || Object.values(names)[0] || '';
	const origin = webOrigin(env);
	return {
		id: channel.id,
		name: both(names.en || name, names.ar || name),
		...(channel.handle ? { handle: channel.handle } : {}),
		url: channel.handle ? `${origin}/en/@${channel.handle}` : `${origin}/en/channels/${encodeURIComponent(channel.id)}`,
	};
}

function links(env: SocialContentEnv, canonical: (lang: SocialLanguage) => string, target: Parameters<typeof shortLinkUrl>[1] | null) {
	const shortOrigin = shortLinkOriginFor(webOrigin(env));
	const canonicalUrl = { en: canonical('en'), ar: canonical('ar') };
	const url = {
		en: (target && shortLinkUrl(shortOrigin, target)) || canonicalUrl.en,
		ar: (target && shortLinkUrl(shortOrigin, target, { lang: 'ar' })) || canonicalUrl.ar,
	};
	return { url, canonicalUrl };
}

/** The content of an event, or null when it is no longer public (deleted, private, hidden, channel gone). */
export async function loadSocialContent(env: SocialContentEnv, channelId: string, event: SocialEvent, entityId: string, opts: { playable?: boolean } = {}): Promise<SocialContent | null> {
	const channel = await readChannel(env, channelId);
	if (!channel) return null;
	const origin = webOrigin(env);
	const base = { event, entityId, channelId, channel: channelPart(env, channel) };

	if (event === 'video' || event === 'short') {
		const video = await new R2Repository<VideoObject>(env.videos).getObject(entityId);
		if (!video || video.channelId !== channelId || !isVideoPubliclyVisible(video as never)) return null;
		const short = isShort(video as never);
		// Feeds need no MP4 (opts.playable false): skips the playback lookup
		const play = opts.playable === false ? null : await loadPublicPlay(env as unknown as PublicPlayEnv, entityId).catch((error) => {
			logger.warn('[Social] Playable lookup failed', { videoId: entityId, error: error instanceof Error ? error.message : String(error) });
			return null;
		});
		const path = short ? 'shorts' : 'video';
		const titles = (video as { titleLocalized?: Record<string, string> }).titleLocalized ?? {};
		const title = video.title || titles.en || titles.ar || '';
		return {
			...base,
			title: both(titles.en || title, titles.ar || title),
			...links(env, (lang) => `${origin}/${lang}/${path}/${encodeURIComponent(entityId)}`, { kind: short ? 'short' : 'video', id: entityId }),
			thumbnailUrl: `${origin}/thumb/${encodeURIComponent(entityId)}.jpg`,
			...(play?.mp4?.url ? { video: { url: play.mp4.url, durationSeconds: Number(video.duration) || 0, width: play.width, height: play.height } } : {}),
			durationSeconds: Number(video.duration) || undefined,
			publishedAt: (video as { publishedAt?: string }).publishedAt || video.dateCreated,
		};
	}

	if (event === 'live') {
		const stream = await readStream(env as unknown as StreamsEnv, entityId);
		if (!stream || stream.channelId !== channelId || stream.isTest || stream.status === 'cancelled' || (stream as { isPrivate?: boolean }).isPrivate) return null;
		return {
			...base,
			title: both(stream.title || ''),
			...links(env, (lang) => `${origin}/${lang}/live/${encodeURIComponent(entityId)}`, null),
			publishedAt: stream.actualStartTime,
		};
	}

	// Community post
	if (!env.community_posts) return null;
	const obj = await env.community_posts.get(`posts/${channelId}/${entityId}.json`);
	if (!obj) return null;
	const post = (await obj.json()) as CommunityPost;
	if (post.status !== PostStatus.PUBLISHED && post.status !== PostStatus.SCHEDULED) return null;
	if (post.visibility && post.visibility !== PostVisibility.PUBLIC) return null;
	if (isUpcoming(post) || isPostHeldByReview(post as never) || (post as { isDeleted?: boolean }).isDeleted || (post as { isHidden?: boolean }).isHidden) return null;
	const text = (post.content ?? '').trim() || (post as { article?: { title?: string } }).article?.title || '';
	return {
		...base,
		title: both(text.split('\n')[0]!.slice(0, 120)),
		text,
		...links(env, (lang) => `${origin}/${lang}/post/${encodeURIComponent(entityId)}`, { kind: 'post', id: entityId }),
		...(post.images?.[0]?.url ? { thumbnailUrl: post.images[0].url } : {}),
		publishedAt: post.scheduledAt || post.createdAt,
	};
}

/** The public payload a webhook receives for an event. */
export function webhookData(c: SocialContent): NonNullable<SocialWebhookPayload['data']> {
	return {
		id: c.entityId,
		kind: c.event,
		title: c.title.en,
		titleLocalized: c.title,
		...(c.text ? { text: c.text } : {}),
		url: c.canonicalUrl.en,
		...(c.url.en !== c.canonicalUrl.en ? { shortUrl: c.url.en } : {}),
		...(c.thumbnailUrl ? { thumbnailUrl: c.thumbnailUrl } : {}),
		...(c.durationSeconds ? { durationSeconds: Math.round(c.durationSeconds) } : {}),
		...(c.publishedAt ? { publishedAt: c.publishedAt } : {}),
	};
}
