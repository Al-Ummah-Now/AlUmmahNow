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
import { PostStatus, PostType, PostVisibility, parsePostFields, type Channel, type CommunityPost, type PostV2Fields } from '@al-ummah/shared-types';
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
      // Converted to a full post (PostV2): Studio owns it now; a late CMS mirror call changes nothing.
      if (typeof p.article?.body === 'string' || p.type === PostType.CARDS) return false;
      p.article = article;
      p.content = input.excerpt ?? undefined;
      p.status = PostStatus.PUBLISHED;
      p.channelName = channel.name;
      p.channelAvatar = channel.avatarUrl;
      p.updatedAt = now;
      return true;
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

/* ── Conversion of CMS scholar posts into full community posts (wiki AUN-SCHOLAR-SITES §6.6) ──── */

/** What the CMS's conversion script sends for one post (PUT /internal/scholars/:userId/posts/:externalId). */
export interface ConvertInput {
  channelId: string;
  kind: 'article' | 'cards';
  /** The PostV2 fields, checked by parsePostFields (article or title + slides; locale, slug, key). */
  fields: PostV2Fields;
  /** The post on www: it keeps its address (the CMS row becomes the reference). */
  www: { url: string; slug: string; locale: 'en' | 'ar' };
  status: 'published' | 'draft';
  publishedAt: string | null;
}

/** Checks the conversion body. Pure; unit-tested. */
export function parseConvert(body: unknown, mediaHost?: (host: string) => boolean): ConvertInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const channelId = typeof b.channelId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(b.channelId) ? b.channelId : '';
  const kind = b.kind === 'article' || b.kind === 'cards' ? b.kind : null;
  const www = (b.www && typeof b.www === 'object' ? b.www : {}) as Record<string, unknown>;
  if (!channelId || !kind || !https(www.url) || typeof www.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(www.slug) || (www.locale !== 'en' && www.locale !== 'ar')) {
    throw new ArticleError(400, 'bad_request');
  }
  const parsed = parsePostFields(kind, b, { mediaHost });
  if ('error' in parsed) throw new ArticleError(400, `bad_${parsed.field}`);
  const publishedAt = typeof b.publishedAt === 'string' && !Number.isNaN(Date.parse(b.publishedAt)) ? new Date(b.publishedAt).toISOString() : null;
  return {
    channelId,
    kind,
    fields: { ...parsed.value, locale: www.locale, slug: www.slug },
    www: { url: www.url as string, slug: www.slug, locale: www.locale },
    status: b.status === 'draft' ? 'draft' : 'published',
    publishedAt,
  };
}

function applyConvert(p: CommunityPost, externalId: string, input: ConvertInput, now: string): void {
  p.type = input.kind === 'article' ? PostType.ARTICLE : PostType.CARDS;
  Object.assign(p, input.fields);
  if (p.article) {
    p.article.url = input.www.url;
    p.article.externalId = externalId;
    p.content = p.article.excerpt ?? undefined;
  } else {
    delete p.article;
    p.content = undefined;
  }
  if (input.kind === 'article') delete p.slides;
  p.www = input.www;
  p.status = input.status === 'draft' ? PostStatus.DRAFT : PostStatus.PUBLISHED;
  p.updatedAt = now;
}

/**
 * Turns a CMS scholar post into a full community post on the scholar's channel. An article that
 * already has a link-only mirror is upgraded IN PLACE (same id, likes and comments); anything else
 * becomes a new post. Idempotent on the CMS key, so the script can be re-run. Sends no queue
 * message: subscribers were told when the post first went out, and the CMS turns its own row into
 * the reference in the same step.
 */
export async function convertScholarPost(env: ArticleEnv, userId: string, externalId: string, input: ConvertInput): Promise<{ post: CommunityPost; created: boolean; upgraded: boolean }> {
  if (!EXTERNAL_ID.test(externalId)) throw new ArticleError(400, 'bad_request');
  const channel = await ownedChannel(env, userId, input.channelId);
  const maps = new R2Repository<Mapping>(env.community_posts);
  const existing = await maps.getObject(mappingKey(externalId));
  if (existing && existing.userId !== userId) throw new ArticleError(403, 'not_owner');
  const now = new Date().toISOString();
  const shown = input.status === 'published';

  if (existing && existing.channelId === input.channelId) {
    const saved = await new R2Repository<CommunityPost>(env.community_posts).updateObject(postKey(existing.channelId, existing.postId), (p) => {
      applyConvert(p, externalId, input, now);
      p.channelName = channel.name;
      p.channelAvatar = channel.avatarUrl;
    });
    if (saved) {
      await setInIndex(env, existing.channelId, existing.postId, shown);
      return { post: saved, created: false, upgraded: true };
    }
  } else if (existing) {
    await setStatus(env, existing, PostStatus.DELETED);
    await setInIndex(env, existing.channelId, existing.postId, false);
  }

  const post = {
    id: crypto.randomUUID(),
    channelId: input.channelId,
    userId,
    type: PostType.TEXT,
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
  } as CommunityPost;
  applyConvert(post, externalId, input, now);
  await env.community_posts.put(postKey(input.channelId, post.id), JSON.stringify(post), { httpMetadata: { contentType: 'application/json' } });
  if (shown) await setInIndex(env, input.channelId, post.id, true);
  await maps.putObject(mappingKey(externalId), { userId, channelId: input.channelId, postId: post.id });
  logger.debug('[ScholarArticles] converted', { externalId, channelId: input.channelId, postId: post.id });
  return { post, created: true, upgraded: false };
}

/** Where a CMS post went (the conversion check and rollback use it). Null = never posted. */
export async function scholarPostMapping(env: ArticleEnv, externalId: string): Promise<Mapping | null> {
  if (!EXTERNAL_ID.test(externalId)) throw new ArticleError(400, 'bad_request');
  return new R2Repository<Mapping>(env.community_posts).getObject(mappingKey(externalId));
}
