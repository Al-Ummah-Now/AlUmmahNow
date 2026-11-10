/**
 * Short vs video formats for admin-web (/video-formats). Every route needs
 * videos:format (lib/roles.ts: admins and super admins).
 *
 *   GET  /api/video-format/runs/latest     latest backfill run and its totals
 *   POST /api/video-format/backfill        { dryRun } start a run (queued; api-videos runs it)
 *   GET  /api/video-format/flagged         videos the rule cannot classify (needs_format)
 *   POST /api/video-format/set             { ids, format: short | video | auto }
 *
 * The rule and the job live in packages/shared-types (video-format.ts,
 * video-format-ops.ts) and api-videos (lib/video-format/job.ts). A manual
 * choice is stored on the video (`format`, `formatSetBy`) with a conditional
 * write; the search and ownership rows follow through the processor's
 * SearchIndexSync queue, like every other admin-api write.
 */
import { z } from 'zod';
import { readVideoFormatRunFrom, startVideoFormatRunWith, videoFormatRunView } from '@al-ummah/shared-types';
import { AdminRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { hasPermission } from '../../lib/roles';
import { type CasBucket } from '../../lib/r2Cas';
import { listFlaggedVideos, setVideoFormats } from '../../lib/videoFormat';
import Queue, { MessageType } from '../../lib/queue';

const TAGS = ['Video formats'];
const VIDEO_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_SET = 50;

abstract class VideoFormatRoute extends AdminRoute {
  protected deny(c: AppContext): Response | null {
    if (hasPermission(this.getRoles(c), 'videos:format')) return null;
    logger.warn('[VideoFormat] Permission denied', { userId: this.getUserId(c), path: c.req.path });
    return c.json({ success: false, error: 'Permission required: videos:format' }, 403);
  }
}

export class VideoFormatLatestRun extends VideoFormatRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Latest Short/video format backfill run',
    description: 'State and totals of the latest run (null when none ran). Needs videos:format.',
    responses: { '200': { description: 'The run' }, '403': { description: 'videos:format required' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c);
    if (denied) return denied;
    return { success: true, result: videoFormatRunView(await readVideoFormatRunFrom(c.env.global_settings as never)) };
  }
}

export class VideoFormatStartBackfill extends VideoFormatRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Start a Short/video format backfill',
    description:
      'Queues a run over every video: classify (≤ 3 min and vertical/square = Short), store Bunny’s encoded size where missing, ' +
      'send videos still processing to the processing loop, flag what cannot be classified and refresh the search index. ' +
      'Runs in the background with retries; a dry run only counts. Needs videos:format.',
    request: { body: { content: { 'application/json': { schema: z.object({ dryRun: z.boolean().default(true) }) } } } },
    responses: { '202': { description: 'Run queued' }, '403': { description: 'videos:format required' }, '503': { description: 'Queue not bound' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c);
    if (denied) return denied;
    const { body } = await this.getValidatedData<typeof this.schema>();
    const queue = c.env.PROCESSING_CHECK_QUEUE;
    if (!queue) return c.json({ success: false, error: 'PROCESSING_CHECK_QUEUE is not bound' }, 503);
    const actorId = this.getUserId(c);
    const run = await startVideoFormatRunWith(c.env.global_settings as never, queue, { dryRun: body.dryRun, requestedBy: actorId });
    logger.info('[VideoFormat] Backfill queued by admin', { runId: run.runId, dryRun: run.dryRun, actorId });
    return c.json({ success: true, result: videoFormatRunView(run) }, 202);
  }
}

export class VideoFormatFlagged extends VideoFormatRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Videos that cannot be classified as Short or video',
    description: 'No duration or encoded size even after re-reading Bunny, and no choice by the uploader. Newest first. Needs videos:format.',
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: { '200': { description: 'Flagged videos and their total' }, '403': { description: 'videos:format required' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c);
    if (denied) return denied;
    const { query } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.SEARCH_DB;
    if (!db) return c.json({ success: false, error: 'SEARCH_DB is not bound' }, 503);
    const { items, total } = await listFlaggedVideos(db as never, c.env.videos as never, query.limit, query.offset);
    return { success: true, result: { items, total, limit: query.limit, offset: query.offset } };
  }
}

export class VideoFormatSet extends VideoFormatRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Set videos’ format by hand',
    description: 'short or video wins over detection and resolves the flag; auto returns the video to detection. Needs videos:format.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              ids: z.array(z.string().regex(VIDEO_ID)).min(1).max(MAX_SET),
              format: z.enum(['short', 'video', 'auto']),
            }),
          },
        },
      },
    },
    responses: { '200': { description: 'Per-video result' }, '403': { description: 'videos:format required' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c);
    if (denied) return denied;
    const { body: raw } = await this.getValidatedData<typeof this.schema>();
    const body = raw as { ids: string[]; format: 'short' | 'video' | 'auto' };
    const actorId = this.getUserId(c);
    const queue = new Queue(c.env.queue);
    // admin-api writes R2 directly: the processor refreshes the search and ownership rows
    const refresh = async (id: string, object: Record<string, unknown>, version: number) => {
      await queue.send(MessageType.SearchIndexSync, { entity: 'video', id, object, version });
    };
    const results = await setVideoFormats(c.env.videos as unknown as CasBucket, refresh, body.ids, body.format, actorId);
    logger.info('[VideoFormat] Format set by admin', { actorId, format: body.format, ids: body.ids.length, changed: results.filter((r) => r.changed).length });
    return { success: true, result: { format: body.format, results } };
  }
}
