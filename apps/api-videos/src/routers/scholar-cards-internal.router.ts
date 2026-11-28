import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../base/types';
import { cardsConfigured } from '../endpoints/community/cards';
import { getJob } from '../lib/admin/jobs';
import { authorizeCard, CARD_JOB, cardRequest, enqueueCard, flagCardPublishFailed, previewCard } from '../lib/cards/publish';

const app = new Hono<{ Bindings: AppBindings }>();
const id = /^[\w-]{1,128}$/u;
app.use('/:userId/:channelId/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (!id.test(c.req.param('userId')) || !id.test(c.req.param('channelId'))) return c.notFound();
  return next();
});

app.get('/:userId/:channelId/availability', async (c) => {
  const { userId, channelId } = c.req.param();
  const channel = cardsConfigured(c.env) && await authorizeCard(c.env, channelId, userId);
  return c.json({ enabled: !!channel && channel.userId === userId });
});

app.post('/:userId/:channelId/:action', async (c) => {
  const { userId, channelId, action } = c.req.param();
  if (action !== 'preview' && action !== 'publish') return c.notFound();
  const channel = await authorizeCard(c.env, channelId, userId);
  if (!channel || channel.userId !== userId) return c.json({ error: 'creator_required' }, 403);
  const origin = c.env.CARD_PUBLIC_ORIGIN;
  if (!origin || !cardsConfigured(c.env)) return c.json({ error: 'cards_unavailable' }, 503);
  const input = cardRequest.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'invalid_request' }, 400);
  if (action === 'preview') {
    try {
      return c.json(await previewCard(c.env, channel, userId, input.data));
    } catch {
      return c.json({ error: 'card_preview_unavailable' }, 503);
    }
  }
  const job = await enqueueCard(c.env, channelId, userId, { ...input.data, origin });
  if (job.status === 'failed') flagCardPublishFailed(c.env, job, job.lastError ?? 'Card could not be queued');
  return c.json({ id: job.id, postId: input.data.id, status: job.status }, 202);
});

app.get('/:userId/:channelId/jobs/:jobId', async (c) => {
  const { userId, channelId, jobId } = c.req.param();
  if (!z.uuid().safeParse(jobId).success || !c.env.SEARCH_DB) return c.notFound();
  const job = await getJob(c.env, jobId);
  if (!job || job.kind !== CARD_JOB || job.actorId !== userId || job.targetId !== channelId) return c.notFound();
  return c.json({ id: job.id, postId: job.params.id, status: job.status });
});

export default app;
