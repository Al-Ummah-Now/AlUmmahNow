/**
 * Scholar articles on the Community tab (AlUmmahNowCMS docs/SCHOLARS.md §4). The CMS publishes a
 * scholar's article to their channel as a community post of type ARTICLE, on the scholar's behalf,
 * through the internal API (routers/scholars-internal.router.ts). This module is the storage side.
 *
 * - One post per article: `scholar-articles/<externalId>.json` (community_posts bucket) maps the CMS
 *   key (`cms-<id>`) to { userId, channelId, postId }. A re-publish updates that post; a different
 *   channel moves it (the old one is hidden); hide/show flip its status and its place in the index.
 * - Only the channel's owner: the CMS says on whose behalf it calls, and the channel record must
 *   belong to that user and be neither suspended nor deleted.
 */
import { PostStatus, PostType, PostVisibility, type Channel, type CommunityPost } from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import { logger } from './logger';
import { channelNameFields } from './channelName';

export interface ArticleInput {
  channelId: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  url: string;
  locale: 'en' | 'ar';
  publishedAt: string | null;
}

interface Mapping {
  userId: string;
  channelId: string;
  postId: string;
}

export interface ArticleEnv {
  channels: R2Bucket;
  community_posts: R2Bucket;
}

export class ArticleError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ArticleError';
  }
}

export const EXTERNAL_ID = /^cms-\d{1,12}$/;
const mappingKey = (externalId: string) => `scholar-articles/${externalId}.json`;
const postKey = (channelId: string, postId: string) => `posts/${channelId}/${postId}.json`;
const indexKey = (channelId: string) => `posts/${channelId}/index.json`;

const https = (v: unknown, max = 2048): v is string => {
  if (typeof v !== 'string' || v.length > max) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Checks the CMS's body. Pure; unit-tested. */
export function parseArticle(body: unknown): ArticleInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
  const channelId = typeof b.channelId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(b.channelId) ? b.channelId : '';
  const title = text(b.title, 300);
  if (!channelId || !title || !https(b.url) || (b.locale !== 'en' && b.locale !== 'ar')) throw new ArticleError(400, 'bad_request');
  if (b.coverUrl != null && !https(b.coverUrl)) throw new ArticleError(400, 'bad_request');
  const excerpt = text(b.excerpt, 1000) || null;
  const publishedAt = typeof b.publishedAt === 'string' && !Number.isNaN(Date.parse(b.publishedAt)) ? new Date(b.publishedAt).toISOString() : null;
  return { channelId, title, excerpt, coverUrl: (b.coverUrl as string | null) ?? null, url: b.url as string, locale: b.locale, publishedAt };
}

async function ownedChannel(env: ArticleEnv, userId: string, channelId: string): Promise<Channel> {
  const obj = (await env.channels.get(channelId)) ?? (await env.channels.get(`${channelId}/channel.json`));
  if (!obj) throw new ArticleError(404, 'channel_not_found');
  const channel = (await obj.json()) as Channel & { isDeleted?: boolean };
  if (channel.userId !== userId) throw new ArticleError(403, 'not_owner');
  if (channel.isSuspended || channel.isDeleted) throw new ArticleError(403, 'channel_suspended');
  return channel;
}

async function setInIndex(env: ArticleEnv, channelId: string, postId: string, present: boolean): Promise<void> {
  type PostIndex = { postIds: string[]; lastUpdated: string };
  await new R2Repository<PostIndex>(env.community_posts).updateObject(
    indexKey(channelId),
    (index) => {
      const has = index.postIds.includes(postId);
      if (present === has) return false;
      index.postIds = present ? [postId, ...index.postIds].slice(0, 1000) : index.postIds.filter((id) => id !== postId);
      index.lastUpdated = new Date().toISOString();
      return true;
    },
    { initial: () => ({ postIds: [], lastUpdated: new Date().toISOString() }) },
  );
}

async function setStatus(env: ArticleEnv, m: Mapping, status: PostStatus): Promise<boolean> {
  const saved = await new R2Repository<CommunityPost>(env.community_posts).updateObject(postKey(m.channelId, m.postId), (p) => {
    if (p.status === status) return false;
    p.status = status;
    p.updatedAt = new Date().toISOString();
    return true;
  });
  return saved !== null;
}

/** Creates or updates the article's community post. Returns it and whether it is new. */
export async function upsertArticle(env: ArticleEnv, userId: string, externalId: string, input: ArticleInput): Promise<{ post: CommunityPost; created: boolean }> {
  if (!EXTERNAL_ID.test(externalId)) throw new ArticleError(400, 'bad_request');
  const channel = await ownedChannel(env, userId, input.channelId);
  const maps = new R2Repository<Mapping>(env.community_posts);
  const existing = await maps.getObject(mappingKey(externalId));
  if (existing && existing.userId !== userId) throw new ArticleError(403, 'not_owner');
  const now = new Date().toISOString();
  const article = { title: input.title, excerpt: input.excerpt, coverUrl: input.coverUrl, url: input.url, locale: input.locale, externalId };

  if (existing && existing.channelId === input.channelId) {
    const saved = await new R2Repository<CommunityPost>(env.community_posts).updateObject(postKey(existing.channelId, existing.postId), (p) => {
      p.article = article;
      p.content = input.excerpt ?? undefined;
      p.status = PostStatus.PUBLISHED;
      p.channelName = channel.name;
      p.channelAvatar = channel.avatarUrl;
      p.updatedAt = now;
    });
    if (saved) {
      await setInIndex(env, existing.channelId, existing.postId, true);
      return { post: saved, created: false };
    }
    // The post object is gone (purged): post it again below.
  } else if (existing) {
    // The scholar's first channel changed: the old channel's post is hidden, a new one goes up.
    await setStatus(env, existing, PostStatus.DELETED);
    await setInIndex(env, existing.channelId, existing.postId, false);
  }

  const post: CommunityPost = {
    id: crypto.randomUUID(),
    channelId: input.channelId,
    userId,
    type: PostType.ARTICLE,
    content: input.excerpt ?? undefined,
    article,
    likes: 0,
    comments: 0,
    shares: 0,
    views: 0,
    createdAt: input.publishedAt ?? now,
    updatedAt: now,
    pinned: false,
    status: PostStatus.PUBLISHED,
    visibility: PostVisibility.PUBLIC,
    commentsEnabled: true,
    ...channelNameFields(channel),
    channelAvatar: channel.avatarUrl,
    channelVerified: channel.isVerified || false,
  };
  await env.community_posts.put(postKey(input.channelId, post.id), JSON.stringify(post), { httpMetadata: { contentType: 'application/json' } });
  await setInIndex(env, input.channelId, post.id, true);
  await maps.putObject(mappingKey(externalId), { userId, channelId: input.channelId, postId: post.id });
  logger.debug('[ScholarArticles] posted', { externalId, channelId: input.channelId, postId: post.id });
  return { post, created: true };
}

/** Hides the article's community post (unpublished or deleted in the CMS). Null = never posted. */
export async function hideArticle(env: ArticleEnv, userId: string, externalId: string): Promise<Mapping | null> {
  if (!EXTERNAL_ID.test(externalId)) throw new ArticleError(400, 'bad_request');
  const m = await new R2Repository<Mapping>(env.community_posts).getObject(mappingKey(externalId));
  if (!m) return null;
  if (m.userId !== userId) throw new ArticleError(403, 'not_owner');
  await setStatus(env, m, PostStatus.DELETED);
  await setInIndex(env, m.channelId, m.postId, false);
  return m;
}
