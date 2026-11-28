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

export function enqueueCard(env: AppBindings, channelId: string, actorId: string, params: z.infer<typeof cardJobParams>) {
  return createJob(env, { kind: CARD_JOB, targetKind: 'channel', targetId: channelId, actorId, params });
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

async function renderToBucket(env: AppBindings, bucket: R2Bucket, key: string, copy: CardCopy, design: z.infer<typeof cardDesignSchema>, locale: 'en' | 'ar') {
  if (await bucket.head(key)) return;
  const image = await captureCard(env, cardDocument(copy, design, locale, await loadCardFonts(bucket)), design.format);
  await bucket.put(key, image, { httpMetadata: { contentType: 'image/png' }, onlyIf: { etagDoesNotMatch: '*' } });
}

export function cardImageKey(channelId: string, id: string, version?: string) {
  return version ? `cards/quran/${version}/${channelId}/${id}.png` : `cards/posts/${channelId}/${id}.png`;
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
  return { html: cardDocument(copy, params.design, params.locale, fonts), ...cardDimensions(params.design.format) };
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
      await renderToBucket(env, bucket, cardImageKey(channelId, params.id, result.version), result.copy, params.design, params.locale);
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
  const imageKey = cardImageKey(channelId, params.id, quran?.version);
  await renderToBucket(env, bucket, imageKey, copy, design, locale);
  const image = {
    ...cardDimensions(design.format),
    url: new URL(`/api/community/channels/${channelId}/cards/${params.id}/image`, params.origin).href,
    alt: quran ? null : cardPostCopy(copy),
  };
  const post: CommunityPost = {
    id: params.id, channelId, userId: channel.userId,
    ...(job.actorId !== channel.userId ? { authorId: job.actorId } : {}),
    type: PostType.CARDS, locale, title: locale === 'ar' ? 'بطاقة مجتمع' : 'Community card',
    content: quran ? undefined : source.kind === 'qaf' && copy.sourceUrl
      ? writeQafQuote(copy.text, copy.citation, copy.sourceUrl)
      : sanitizePostContent(cardPostCopy(copy).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')),
    slides: [{ id: params.id, image, heading: null, body: null, position: 'bottom' }],
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
  const image = await env.MEDIA_PRIVATE?.head(cardImageKey(post.channelId, post.id, result.version));
  if (!image) await queueQuranCardRefresh(env, post, result.version);
  return {
    ...post,
    content: cardPostCopy(copy),
    slides: image ? post.slides?.map((slide) => ({ ...slide, image: { ...slide.image, alt: cardPostCopy(copy) } })) : [],
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
  const bucket = env.MEDIA_PRIVATE;
  const claim = `cards/quran/${version}/${post.channelId}/${post.id}.refresh`;
  if (!(await bucket.put(claim, '', { onlyIf: { etagDoesNotMatch: '*' } }))) return;
  try {
    const job = await enqueueCard(env, post.channelId, post.authorId ?? post.userId, {
      id: post.id, source: { kind: 'quran', ...verse }, design: design.data,
      locale: post.locale === 'ar' ? 'ar' : 'en', roles: [], origin: env.CARD_PUBLIC_ORIGIN, refreshVersion: version,
    });
    if (job.status === 'failed') flagCardPublishFailed(env, job, job.lastError ?? 'Card refresh could not be queued');
  } catch (error) {
    await bucket.delete(claim);
    throw error;
  }
}
