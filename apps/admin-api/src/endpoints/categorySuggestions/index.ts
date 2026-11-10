/**
 * /api/category-suggestions/* — review of AI category suggestions.
 * Super Admin, Admin and Moderator can view; Super Admin and Admin accept,
 * change, retry, run the backfill and change the settings. Every change is
 * audited (moderation_actions). Self-contained so the admin Videos pages can host
 * the same review (admin-web components/CategorySuggestionsReview).
 */
import { Num, Str } from 'chanfana';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { VideoCategory, type SearchDb } from '@al-ummah/shared-types';
import { AdminRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import {
  MAX_BULK,
  SUGGESTION_VIEWS,
  applyAdminCategory,
  backfillPage,
  listSuggestions,
  readCategorizeConfig,
  readCategorizeUsage,
  retrySuggestions,
  suggestionStats,
  writeCategorizeConfig,
  type D1Like,
  type ListableBucket,
  type Producer,
} from '../../lib/categorySuggestions';

const ok = (description: string) => ({ '200': { description } });
const searchDb = (c: AppContext): SearchDb => {
  const db = c.env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!db) throw new HTTPException(503, { message: 'SEARCH_DB not bound' });
  return db;
};
const reports = (c: AppContext) => c.env.REPORTS_DB as unknown as D1Like;
const videos = (c: AppContext) => c.env.videos as unknown as ListableBucket;
const envVars = (c: AppContext) => c.env as unknown as Record<string, string | undefined>;
const ids = z.array(Str()).min(1).max(MAX_BULK);

abstract class EditRoute extends AdminRoute {
  protected requireAdmin(c: AppContext) {
    if (!this.isAdmin(c)) throw new HTTPException(403, { message: 'Admin role required' });
  }
}

export class CategorySuggestionsList extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['Category suggestions'],
    summary: 'List AI category suggestions by review queue',
    description: 'review: AI-set categories nobody confirmed (least confident first). needs_category: AI answered but set nothing. flagged: failed, budget-capped, switched off or stuck (Retry). reviewed: accepted or changed.',
    request: {
      query: z.object({
        view: z.enum(SUGGESTION_VIEWS as [string, ...string[]]).optional(),
        category: z.nativeEnum(VideoCategory).optional(),
        videoId: Str({ required: false, description: 'Only this video (deep link from a video page)' }),
        limit: Num({ required: false }),
        offset: Num({ required: false }),
      }),
    },
    responses: ok('Suggestions with their videos'),
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const result = await listSuggestions(searchDb(c), c.env.videos as never, query as never);
    return { success: true, result: { ...result, canEdit: this.isAdmin(c) } };
  }
}

export class CategorySuggestionsStats extends AdminRoute {
  schema = addAuthToSchema({ tags: ['Category suggestions'], summary: 'Queue counts, Explore categories, settings and today\'s AI usage', responses: ok('Stats') });

  async handle(c: AppContext) {
    const [stats, config, usage] = await Promise.all([
      suggestionStats(searchDb(c)),
      readCategorizeConfig(reports(c), envVars(c)),
      readCategorizeUsage(reports(c)),
    ]);
    return { success: true, result: { ...stats, config, usage, canEdit: this.isAdmin(c) } };
  }
}

export class CategorySuggestionsAccept extends EditRoute {
  schema = addAuthToSchema({
    tags: ['Category suggestions'],
    summary: 'Accept the suggested category of each video (Super Admin / Admin)',
    request: { body: { content: { 'application/json': { schema: z.object({ videoIds: ids }) } } } },
    responses: ok('Per-video results'),
  });

  async handle(c: AppContext) {
    this.requireAdmin(c);
    const { body } = await this.getValidatedData<typeof this.schema>();
    const results = await applyAdminCategory({ db: searchDb(c), reports: reports(c), videos: videos(c) }, body.videoIds, { kind: 'accept' }, this.getUserId(c));
    logger.info('[CategorySuggestions] Accepted', { actorId: this.getUserId(c), total: results.length, ok: results.filter((r) => r.ok).length });
    return { success: true, result: { results } };
  }
}

export class CategorySuggestionsSet extends EditRoute {
  schema = addAuthToSchema({
    tags: ['Category suggestions'],
    summary: 'Set a category on each video (change a suggestion; Super Admin / Admin)',
    request: { body: { content: { 'application/json': { schema: z.object({ videoIds: ids, category: z.nativeEnum(VideoCategory) }) } } } },
    responses: ok('Per-video results'),
  });

  async handle(c: AppContext) {
    this.requireAdmin(c);
    const { body } = await this.getValidatedData<typeof this.schema>();
    const results = await applyAdminCategory({ db: searchDb(c), reports: reports(c), videos: videos(c) }, body.videoIds, { kind: 'set', category: body.category }, this.getUserId(c));
    logger.info('[CategorySuggestions] Category set', { actorId: this.getUserId(c), category: body.category, total: results.length, ok: results.filter((r) => r.ok).length });
    return { success: true, result: { results } };
  }
}

export class CategorySuggestionsRetry extends EditRoute {
  schema = addAuthToSchema({
    tags: ['Category suggestions'],
    summary: 'Re-queue AI suggestions for these videos (Super Admin / Admin)',
    request: { body: { content: { 'application/json': { schema: z.object({ videoIds: ids }) } } } },
    responses: ok('Queued'),
  });

  async handle(c: AppContext) {
    this.requireAdmin(c);
    const { body } = await this.getValidatedData<typeof this.schema>();
    const results = await retrySuggestions({ db: searchDb(c), reports: reports(c), queue: c.env.queue as Producer }, body.videoIds, this.getUserId(c));
    logger.info('[CategorySuggestions] Retry queued', { actorId: this.getUserId(c), total: results.length });
    return { success: true, result: { results } };
  }
}

export class CategorySuggestionsBackfill extends EditRoute {
  schema = addAuthToSchema({
    tags: ['Category suggestions'],
    summary: 'One page of the backfill over videos without a category (dry run by default; Super Admin / Admin)',
    description: 'Lists one page of the videos bucket. dryRun=true (default) only counts. With dryRun=false, each video without a category and without a suggestion is queued for the processor (budget-capped, retried, idempotent). Call again with nextCursor until done.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({ dryRun: z.boolean().optional().default(true), cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(200).optional() }),
          },
        },
      },
    },
    responses: ok('Page summary'),
  });

  async handle(c: AppContext) {
    this.requireAdmin(c);
    const { body } = await this.getValidatedData<typeof this.schema>();
    const page = await backfillPage({ db: searchDb(c), reports: reports(c), videos: videos(c), queue: c.env.queue as Producer }, body, this.getUserId(c));
    logger.info('[CategorySuggestions] Backfill page', { actorId: this.getUserId(c), ...page });
    return { success: true, result: page };
  }
}

export class CategorizeConfigUpdate extends EditRoute {
  schema = addAuthToSchema({
    tags: ['Category suggestions'],
    summary: 'Change AI category suggestion settings (Super Admin / Admin)',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({ enabled: z.boolean().optional(), dailyNeuronCap: z.number().int().min(0).max(10_000_000).optional(), threshold: z.number().min(0.3).max(0.95).optional() }),
          },
        },
      },
    },
    responses: ok('Updated'),
  });

  async handle(c: AppContext) {
    this.requireAdmin(c);
    const { body } = await this.getValidatedData<typeof this.schema>();
    const error = await writeCategorizeConfig(reports(c), body, this.getUserId(c));
    if (error) return c.json({ success: false, error }, 400);
    logger.info('[CategorySuggestions] Settings changed', { actorId: this.getUserId(c), keys: Object.keys(body) });
    return { success: true, result: await readCategorizeConfig(reports(c), envVars(c)) };
  }
}
