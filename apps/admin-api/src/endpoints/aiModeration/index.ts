/**
 * /api/moderation/ai/* (Epic 28). Super Admin, Admin and Moderator can view and review;
 * only Super Admin and Admin change the config (kill switch, cap, policies).
 */
import { Num, Str } from 'chanfana';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { AdminRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import {
  getSignal,
  getSubjectContent,
  listSignals,
  readConfig,
  readUsage,
  reviewSignal,
  setCommentHidden,
  validateConfigPatch,
  writeConfig,
  type D1Like,
  type R2Like,
} from '../../lib/aiModeration';

const ok = (description: string) => ({ '200': { description } });
const db = (c: AppContext) => c.env.REPORTS_DB as unknown as D1Like;

export class AiSignalsList extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['AI Moderation'],
    summary: 'List AI moderation signals',
    request: {
      query: z.object({
        review_status: z.enum(['pending', 'agreed', 'disagreed', 'n/a']).optional(),
        decision: z.enum(['none', 'would_flag', 'would_hide', 'flag', 'hide', 'skipped']).optional(),
        surface: z.enum(['video_comment', 'community_post', 'post_comment', 'video_metadata']).optional(),
        language: z.enum(['ar', 'en', 'other']).optional(),
        category: Str({ required: false }),
        limit: Num({ required: false }),
        offset: Num({ required: false }),
      }),
    },
    responses: ok('Signals, highest priority first'),
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return { success: true, result: await listSignals(db(c), query) };
  }
}

export class AiSignalGet extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['AI Moderation'],
    summary: 'Get a signal with its audit trail and the live subject text',
    request: { params: z.object({ id: Str() }) },
    responses: ok('Signal'),
  });

  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const found = await getSignal(db(c), params.id);
    if (!found) return c.json({ success: false, error: 'not_found' }, 404);
    let content = null;
    try {
      content = await getSubjectContent(
        { videos: c.env.videos as unknown as R2Like, community_posts: c.env.community_posts as unknown as R2Like | undefined },
        found.signal
      );
    } catch (error) {
      logger.warn('[AiModeration] Subject content unavailable', { id: params.id, error });
    }
    return { success: true, result: { ...found, content } };
  }
}

export class AiSignalReview extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['AI Moderation'],
    summary: 'Agree or disagree with the AI (feedback label)',
    request: {
      params: z.object({ id: Str() }),
      body: { content: { 'application/json': { schema: z.object({ verdict: z.enum(['agree', 'disagree']), note: z.string().max(500).optional() }) } } },
    },
    responses: ok('Reviewed'),
  });

  async handle(c: AppContext) {
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const result = await reviewSignal(db(c), params.id, body.verdict, this.getUserId(c), body.note);
    if (!result) return c.json({ success: false, error: 'not_found' }, 404);
    logger.info('[AiModeration] Signal reviewed', { id: params.id, verdict: body.verdict, reviewerId: this.getUserId(c) });
    return { success: true, result };
  }
}

export class AiSignalVisibility extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['AI Moderation'],
    summary: 'Hide or restore the subject (video comments; reversible)',
    request: {
      params: z.object({ id: Str() }),
      body: { content: { 'application/json': { schema: z.object({ hidden: z.boolean(), reason: z.string().max(500).optional() }) } } },
    },
    responses: ok('Visibility changed'),
  });

  async handle(c: AppContext) {
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const result = await setCommentHidden(db(c), c.env.videos as unknown as R2Like, params.id, body.hidden, this.getUserId(c), body.reason);
    if ('error' in result) {
      const status = result.error === 'not_found' || result.error === 'subject_missing' ? 404 : 400;
      return c.json({ success: false, error: result.error }, status);
    }
    logger.info('[AiModeration] Visibility changed', { id: params.id, hidden: body.hidden, changed: result.changed, reviewerId: this.getUserId(c) });
    return { success: true, result };
  }
}

export class AiConfigGet extends AdminRoute {
  schema = addAuthToSchema({ tags: ['AI Moderation'], summary: 'AI moderation config', responses: ok('Config') });

  async handle(c: AppContext) {
    const config = await readConfig(db(c), (c.env as unknown as Record<string, string | undefined>).AI_MODERATION_DAILY_NEURON_CAP);
    return { success: true, result: { ...config, canEdit: this.isAdmin(c) } };
  }
}

const policySchema = z.object({
  mode: z.enum(['shadow', 'enforce']).optional(),
  threshold: z.number().min(0).max(1).optional(),
  action: z.enum(['none', 'flag', 'hide']).optional(),
  enabled: z.boolean().optional(),
});

export class AiConfigUpdate extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['AI Moderation'],
    summary: 'Update AI moderation config (Super Admin / Admin)',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              enabled: z.boolean().optional(),
              dailyNeuronCap: z.number().int().min(0).max(10_000_000).optional(),
              extensionsEnabled: z.boolean().optional(),
              policies: z.record(z.string(), policySchema).optional(),
            }),
          },
        },
      },
    },
    responses: ok('Updated'),
  });

  async handle(c: AppContext) {
    if (!this.isAdmin(c)) throw new HTTPException(403, { message: 'Admin role required' });
    const { body } = await this.getValidatedData<typeof this.schema>();
    const error = validateConfigPatch(body);
    if (error) return c.json({ success: false, error }, 400);
    await writeConfig(db(c), body, this.getUserId(c));
    logger.info('[AiModeration] Config changed', { actorId: this.getUserId(c), keys: Object.keys(body) });
    return { success: true, result: await readConfig(db(c)) };
  }
}

export class AiUsageGet extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['AI Moderation'],
    summary: 'Workers AI usage for moderation (per day × model) and today against the cap',
    request: { query: z.object({ days: Num({ required: false }) }) },
    responses: ok('Usage'),
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const usage = await readUsage(db(c), query.days ?? 30);
    const config = await readConfig(db(c), (c.env as unknown as Record<string, string | undefined>).AI_MODERATION_DAILY_NEURON_CAP);
    return { success: true, result: { ...usage, dailyNeuronCap: config.dailyNeuronCap } };
  }
}
