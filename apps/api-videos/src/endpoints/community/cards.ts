import { z } from 'zod';
import { PostStatus, isPostHeldByReview, type CommunityPost } from '@al-ummah/shared-types';
import { AuthenticatedRoute, PublicRoute, type AppContext } from '../../base';
import { getJob, retryJob } from '../../lib/admin/jobs';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { isChannelDeleted } from '../../lib/community-posts';
import { readQuranCurrent } from '../../lib/quran/copy';
import { authorizeCard, CARD_JOB, cardImageKey, cardRequest, enqueueCard, flagCardPublishFailed, previewCard, queueQuranCardRefresh } from '../../lib/cards/publish';

const channel = z.object({ channelId: z.string().min(1).max(128).regex(/^[\w-]+$/u) });
const response = { description: 'Card publish job', content: { 'application/json': { schema: z.any() } } };

export function cardsConfigured(env: AppContext['env']) {
  return !!(env.CARD_PUBLIC_ORIGIN && env.CARD_RENDER_ACCOUNT && env.CARD_RENDER_TOKEN && env.MEDIA_PRIVATE && env.ADMIN_JOBS_QUEUE);
}

export class CardAvailability extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'], summary: 'Check whether a creator can publish designed cards',
    request: { params: channel }, responses: { 200: response },
  }, 'required');

  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const auth = this.getAuth(c);
    c.header('Cache-Control', 'private, no-store');
    return c.json({ enabled: cardsConfigured(c.env) && !!(await authorizeCard(c.env, params.channelId, auth.userId, auth.payload.roles ?? [])) });
  }
}

export class CardPreview extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'], summary: 'Preview the selected source and card design',
    request: { params: channel, body: { content: { 'application/json': { schema: cardRequest } } } },
    responses: { 200: response, 403: { description: 'Creator or channel access required' }, 503: { description: 'Card source unavailable' } },
  }, 'required');

  async handle(c: AppContext) {
    const { body, params } = await this.getValidatedData<typeof this.schema>();
    const auth = this.getAuth(c);
    const record = await authorizeCard(c.env, params.channelId, auth.userId, auth.payload.roles ?? []);
    if (!record) return c.json({ error: 'creator_required' }, 403);
    c.header('Cache-Control', 'private, no-store');
    if (!cardsConfigured(c.env)) return c.json({ error: 'cards_unavailable' }, 503);
    try {
      return c.json(await previewCard(c.env, record, auth.userId, body));
    } catch {
      return c.json({ error: 'card_preview_unavailable' }, 503);
    }
  }
}

export class PublishCard extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'], summary: 'Queue a community image card',
    request: { params: channel, body: { content: { 'application/json': { schema: cardRequest } } } },
    responses: { 202: response, 403: { description: 'Creator or channel access required' }, 503: { description: 'Rendering unavailable' } },
  }, 'required');

  async handle(c: AppContext) {
    const { body, params } = await this.getValidatedData<typeof this.schema>();
    const auth = this.getAuth(c);
    const roles = auth.payload.roles ?? [];
    if (!(await authorizeCard(c.env, params.channelId, auth.userId, roles))) {
      return c.json({ error: 'creator_required' }, 403);
    }
    const origin = c.env.CARD_PUBLIC_ORIGIN;
    if (!origin || !cardsConfigured(c.env)) {
      return c.json({ error: 'cards_unavailable' }, 503);
    }
    const job = await enqueueCard(c.env, params.channelId, auth.userId, { ...body, roles, origin });
    if (job.status === 'failed') flagCardPublishFailed(c.env, job, job.lastError ?? 'Card could not be queued');
    return c.json({ id: job.id, postId: body.id, status: job.status }, 202);
  }
}

export class CardPublishStatus extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'], summary: 'Read the state of a card publish job',
    request: { params: channel.extend({ jobId: z.uuid() }) },
    responses: { 200: response, 404: { description: 'Job not found' } },
  }, 'required');

  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const job = c.env.SEARCH_DB && await getJob(c.env, params.jobId);
    if (!job || job.kind !== CARD_JOB || job.targetId !== params.channelId || job.actorId !== this.getUserId(c)) {
      return c.json({ error: 'job_not_found' }, 404);
    }
    c.header('Cache-Control', 'private, no-store');
    return c.json({ id: job.id, postId: job.params.id, status: job.status });
  }
}

export class CardImage extends PublicRoute {
  schema = {
    tags: ['Community'], summary: 'Read the generated image of a published community card',
    request: { params: channel.extend({ cardId: z.uuid() }) },
    responses: { 200: { description: 'Card PNG' }, 404: { description: 'Card image unavailable' } },
  };

  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const { channelId, cardId } = params;
    const bucket = c.env.MEDIA_PRIVATE;
    if (!bucket) return c.notFound();
    const stored = await c.env.community_posts.get(`posts/${channelId}/${cardId}.json`);
    const post = await stored?.json<CommunityPost>();
    if (!post?.designedCard || post.status !== PostStatus.PUBLISHED || isPostHeldByReview(post as never) || await isChannelDeleted(c.env.channels, channelId)) {
      return c.notFound();
    }
    const current = post.designedCard.quran && await readQuranCurrent(bucket);
    if (post.designedCard.quran && !current) return c.notFound();
    const image = await bucket.get(cardImageKey(channelId, cardId, current?.version));
    if (!image) {
      if (current) await queueQuranCardRefresh(c.env, post, current.version);
      c.header('Cache-Control', 'private, no-store');
      return c.notFound();
    }
    return new Response(image.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
  }
}


export async function retryCardPublish(c: AppContext) {
  const input = z.object({ jobId: z.uuid() }).safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'invalid_request' }, 400);
  const job = await getJob(c.env, input.data.jobId);
  if (!job || job.kind !== CARD_JOB) return c.json({ error: 'job_not_found' }, 404);
  const updated = await retryJob(c.env, job.id);
  if (!updated) return c.json({ error: 'job_not_retryable' }, 409);
  return c.json({ success: true, result: { job: updated } }, 202);
}
