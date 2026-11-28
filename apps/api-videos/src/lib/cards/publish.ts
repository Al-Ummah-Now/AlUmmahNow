import {
  can, channelRoleOf, PostStatus, PostType, PostVisibility, writeQafQuote,
  reportNeedsAction, resolveNeedsAction, type ErrorReporterEnv, type AdminJob, type Channel, type CommunityPost,
} from '@al-ummah/shared-types';
import { z } from 'zod';
import { getChannelObject } from '../../endpoints/community/post-comment-helpers';
import type { AppBindings } from '../../base/types';
import { createJob, type JobOutcome } from '../admin/jobs';
import { channelNameFields } from '../channelName';
import Queue, { MessageType } from '../queue';
import { addToChannelIndex, writeCommunityPost, type WritePostEnv } from '../community/writePost';
import { rememberPostLocation } from '../community-posts';
import { sanitizePostContent } from '../post-content';
import { cardPages } from './paginate';
import { captureCard } from './capture';
import { cardDesignSchema, cardDimensions, cardDocument } from './design';
import { canCreateCard, cardSourceSchema, readQafCard, readQuranCard, type CardCopy } from './source';

export const CARD_JOB = 'card.publish' as const;
export const cardRequest = z.strictObject({
  id: z.uuid(),
  source: cardSourceSchema,
  design: cardDesignSchema,
  locale: z.enum(['en', 'ar']),
});
const cardJobParams = cardRequest.extend({ origin: z.url(), roles: z.array(z.string()).optional(), refreshVersion: z.string().optional() });

export async function authorizeCard(env: AppBindings, channelId: string, actorId: string, roles?: string[]) {
  if (!env.SEARCH_DB || !(await canCreateCard(env.SEARCH_DB, { userId: actorId, roles }))) return null;
  const object = await getChannelObject(env.channels, channelId);
  const channel = await object?.json<Channel & { isDeleted?: boolean }>();
  if (!channel || channel.isDeleted || channel.isSuspended || !can(channelRoleOf(channel as never, actorId), 'post.manage')) return null;
  return channel;
}

export async function enqueueCard(env: AppBindings, channelId: string, actorId: string, params: z.infer<typeof cardJobParams>) {
  const identity = [channelId, actorId, params.id, params.refreshVersion ?? 'publish'].join(':');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)));
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  return createJob(env, { id, kind: CARD_JOB, targetKind: 'channel', targetId: channelId, actorId, params: { ...params, id: params.refreshVersion ? params.id : id } });
}

async function fontBase64(bucket: R2Bucket, key: string): Promise<string> {
  const font = await bucket.get(key);
  if (!font || font.size > 500_000) throw new Error('Card font asset unavailable');
  const bytes = new Uint8Array(await font.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function loadCardFonts(bucket: R2Bucket) {
  const [amiri, sourceSerif] = await Promise.all([
    fontBase64(bucket, 'cards/fonts/amiri-arabic-400-normal.woff2'),
    fontBase64(bucket, 'cards/fonts/source-serif-4-latin-400-normal.woff2'),
  ]);
  return { amiri, sourceSerif };
}

export function cardImageKey(channelId: string, id: string, version?: string, page?: number) {
  const file = page === undefined ? id : `${id}-p${page + 1}`;
  return version ? `cards/quran/${version}/${channelId}/${file}.png` : `cards/posts/${channelId}/${file}.png`;
}

async function renderPages(env: AppBindings, bucket: R2Bucket, channelId: string, id: string, pages: CardCopy[], design: z.infer<typeof cardDesignSchema>, locale: 'en' | 'ar', version?: string) {
  const fonts = await loadCardFonts(bucket);
  for (const [page, copy] of pages.entries()) {
    const key = cardImageKey(channelId, id, version, page);
    if (await bucket.head(key)) continue;
    const image = await captureCard(env, cardDocument(copy, design, locale, fonts), design.format);
    await bucket.put(key, image, { httpMetadata: { contentType: 'image/png' }, onlyIf: { etagDoesNotMatch: '*' } });
  }
}

function cardSlides(channelId: string, id: string, origin: string, pages: CardCopy[], design: z.infer<typeof cardDesignSchema>, includeText: boolean): NonNullable<CommunityPost['slides']> {
  return pages.map((copy, page) => ({
    id: `${id}-${page + 1}`,
    image: {
      ...cardDimensions(design.format),
      url: new URL(`/api/community/channels/${channelId}/cards/${id}/image?page=${page + 1}`, origin).href,
      alt: includeText ? cardPostCopy(copy) : null,
    },
    heading: null, body: null, position: 'bottom',
  }));
}

export function cardPostCopy(copy: CardCopy) {
  return [copy.text, copy.citation, copy.credit].filter(Boolean).join('\n\n');
}

async function resolveCardCopy(env: AppBindings, channel: Channel, actorId: string, { source, locale }: z.infer<typeof cardRequest>) {
  const quran = source.kind === 'quran' ? await readQuranCard(env.MEDIA_PRIVATE, source, locale) : null;
  let copy: CardCopy;
  switch (source.kind) {
    case 'quran':
      if (!quran) throw new Error('Synced verse is unavailable');
      copy = quran.copy;
      break;
    case 'qaf':
      copy = await readQafCard(env, actorId, source, locale);
      break;
    case 'message': {
      const { channelName } = channelNameFields(channel);
      copy = { text: source.text, citation: channelName };
      break;
    }
  }
  if (!copy.citation.trim()) throw new Error('Card source attribution is missing');
  return { copy, quran };
}

export async function previewCard(env: AppBindings, channel: Channel, actorId: string, params: z.infer<typeof cardRequest>) {
  const bucket = env.MEDIA_PRIVATE;
  if (!bucket) throw new Error('Card media storage is unavailable');
  const { copy } = await resolveCardCopy(env, channel, actorId, params);
  const fonts = await loadCardFonts(bucket);
  return {
    pages: cardPages(copy, params.design, params.locale).map((page) => cardDocument(page, params.design, params.locale, fonts)),
    ...cardDimensions(params.design.format),
  };
}

export async function runCardPublish(env: AppBindings, job: AdminJob, ctx: Pick<ExecutionContext, 'waitUntil'>): Promise<JobOutcome> {
  const params = cardJobParams.parse(job.params);
  const channelId = job.targetId;
  const key = `posts/${channelId}/${params.id}.json`;
  const bucket = env.MEDIA_PRIVATE;
  if (!bucket) throw new Error('Card media storage is unavailable');
  const existing = await env.community_posts.get(key);
  if (params.refreshVersion) {
    const post = await existing?.json<CommunityPost>();
    if (!post?.designedCard?.quran || post.status !== PostStatus.PUBLISHED || params.source.kind !== 'quran') {
      return { done: true };
    }
    const result = await readQuranCard(bucket, params.source, params.locale);
    if (!result) throw new Error('Synced verse is unavailable');
    if (result.version === params.refreshVersion) {
      await renderPages(env, bucket, channelId, params.id, cardPages(result.copy, params.design, params.locale), params.design, params.locale, result.version);
    }
    return { done: true, result: { postId: params.id } };
  }
  const channel = await authorizeCard(env, channelId, job.actorId, params.roles);
  if (!channel) throw new Error('Creator or channel access is unavailable');
  if (existing) {
    if (!(await existing.json<CommunityPost>()).designedCard) throw new Error('Card ID already belongs to a post');
    await rememberPostLocation(env.community_posts, params.id, channelId);
    await addToChannelIndex(env.community_posts, channelId, params.id);
    await new Queue(env.queue as never).send(MessageType.CommunityPostCreated, {
      postId: params.id, channelId, actor: { userId: job.actorId }, timestamp: job.createdAt, skipSocial: true,
    });
    return { done: true, result: { postId: params.id } };
  }

  const { source, locale, design } = params;
  const { copy, quran } = await resolveCardCopy(env, channel, job.actorId, params);
  const pages = cardPages(copy, design, locale);
  await renderPages(env, bucket, channelId, params.id, pages, design, locale, quran?.version);
  const slides = cardSlides(channelId, params.id, params.origin, pages, design, !quran);
  const post: CommunityPost = {
    id: params.id, channelId, userId: channel.userId,
    ...(job.actorId !== channel.userId ? { authorId: job.actorId } : {}),
    type: PostType.CARDS, locale, title: locale === 'ar' ? 'بطاقة مجتمع' : 'Community card',
    content: quran ? undefined : source.kind === 'qaf' && copy.sourceUrl
      ? writeQafQuote(copy.text, copy.citation, copy.sourceUrl)
      : sanitizePostContent(cardPostCopy(copy).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')),
    slides,
    designedCard: quran && source.kind === 'quran' ? { quran: { surah: source.surah, ayah: source.ayah }, design } : {},
    likes: 0, comments: 0, shares: 0, views: 0,
    createdAt: job.createdAt, pinned: false, status: PostStatus.PUBLISHED,
    visibility: PostVisibility.PUBLIC, commentsEnabled: true,
    ...channelNameFields(channel), channelAvatar: channel.avatarUrl, channelVerified: channel.isVerified || false,
  };
  await writeCommunityPost({ env: env as unknown as WritePostEnv, executionCtx: ctx }, post, { userId: job.actorId }, { skipSocial: true });
  return { done: true, result: { postId: params.id } };
}


export async function hydrateDesignedCard(env: AppBindings, post: CommunityPost): Promise<CommunityPost> {
  const verse = post.designedCard?.quran;
  if (!verse) return post;
  const result = await readQuranCard(env.MEDIA_PRIVATE, { kind: 'quran', ...verse }, post.locale === 'ar' ? 'ar' : 'en');
  if (!result) return { ...post, slides: [] };
  const copy = result.copy;
  const design = cardDesignSchema.safeParse(post.designedCard?.design);
  const origin = env.CARD_PUBLIC_ORIGIN ?? post.slides?.[0]?.image.url;
  if (!design.success || !origin) return { ...post, content: cardPostCopy(copy), slides: [] };
  const pages = cardPages(copy, design.data, post.locale === 'ar' ? 'ar' : 'en');
  const image = await env.MEDIA_PRIVATE?.head(cardImageKey(post.channelId, post.id, result.version, pages.length - 1));
  if (!image) await queueQuranCardRefresh(env, post, result.version);
  return {
    ...post,
    content: cardPostCopy(copy),
    slides: image ? cardSlides(post.channelId, post.id, origin, pages, design.data, true) : [],
  };
}

export function flagCardPublishFailed(env: AppBindings, job: AdminJob, error: string) {
  reportNeedsAction('api-videos', env as ErrorReporterEnv, undefined, {
    key: `card-publish:${job.id}`,
    source: 'admin-job',
    title: 'Community card could not be published',
    message: error.slice(0, 400),
    itemType: 'admin-job',
    itemId: job.id,
    itemUrl: `/jobs/${job.id}`,
    retry: { kind: 'service', service: 'api-videos', path: '/internal/community/cards/retry', body: { jobId: job.id } },
    extra: { jobId: job.id, channelId: job.targetId },
  });
}

export function resolveCardPublishAlert(env: AppBindings, ctx: Pick<ExecutionContext, 'waitUntil'>, job: AdminJob) {
  return resolveNeedsAction(env as ErrorReporterEnv, ctx, `card-publish:${job.id}`);
}


/** Claim at most one refresh job per post and sync version. The job itself owns retries. */
export async function queueQuranCardRefresh(env: AppBindings, post: CommunityPost, version: string) {
  const verse = post.designedCard?.quran;
  const design = cardDesignSchema.safeParse(post.designedCard?.design);
  if (!env.CARD_PUBLIC_ORIGIN || !env.MEDIA_PRIVATE || !env.ADMIN_JOBS_QUEUE || !env.SEARCH_DB || !verse || !design.success) return;
  const job = await enqueueCard(env, post.channelId, post.authorId ?? post.userId, {
    id: post.id, source: { kind: 'quran', ...verse }, design: design.data,
    locale: post.locale === 'ar' ? 'ar' : 'en', origin: env.CARD_PUBLIC_ORIGIN, refreshVersion: version,
  });
  if (job.status === 'failed') flagCardPublishFailed(env, job, job.lastError ?? 'Card refresh could not be queued');
}
