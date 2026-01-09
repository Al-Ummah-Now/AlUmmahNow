import { AdminRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError, ReportSchema, Report } from "../../lib/types";
import { logger } from "../../lib/logger";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

const ActionInput = z.object({
  action: z.enum(['warning', 'removed', 'banned', 'dismissed']),
  notes: Str({ description: "Moderator notes" }).optional(),
});

export class ReportAction extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Moderation"],
    summary: "Take Moderation Action",
    description: "Take action on a reported content item. Updates the report status and optionally applies the action to the content.",
    request: {
      params: z.object({
        reportId: Str({ description: "Report ID" }),
      }),
      body: {
        content: {
          "application/json": {
            schema: ActionInput,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns the updated report",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                report: ReportSchema,
                contentAction: z.object({
                  performed: z.boolean(),
                  action: z.string(),
                  notes: z.string().optional(),
                }),
              }),
            }),
          },
        },
      },
      "404": {
        description: "Report not found",
        content: {
          "application/json": {
            schema: ResponseError,
          },
        },
      },
      "500": {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: ResponseError,
          },
        },
      },
    },
  });

  async handle(c: AppContext) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { reportId } = request.params;
    const { action, notes } = request.body;
    const moderatorId = this.getUserId(c);

    try {
      const db = c.env.REPORTS_DB;

      // Get the report
      const report = await db.prepare(
        'SELECT * FROM reports WHERE id = ?'
      ).bind(reportId).first<Report>();

      if (!report) {
        return c.json({
          success: false,
          error: 'Report not found',
        }, 404);
      }

      const now = new Date().toISOString();
      const newStatus = action === 'dismissed' ? 'dismissed' : 'resolved';

      // Update the report
      await db.prepare(`
        UPDATE reports
        SET status = ?, moderator_id = ?, action = ?, moderator_notes = ?, updated_at = ?, resolved_at = ?
        WHERE id = ?
      `).bind(newStatus, moderatorId, action, notes || null, now, now, reportId).run();

      // Perform content action if not dismissed
      let contentAction: { performed: boolean; action: string; notes: string } = {
        performed: false,
        action,
        notes: 'No action taken'
      };

      if (action !== 'dismissed') {
        const result = await this.performContentAction(
          c,
          report.entity_type,
          report.entity_id,
          action,
          notes
        );
        contentAction = {
          performed: result.performed,
          action: result.action,
          notes: result.notes || 'Action completed'
        };
      }

      // Queue notification about moderation action
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.ReportResolve, {
        reportId,
        entityType: report.entity_type,
        entityId: report.entity_id,
        moderatorId,
        action,
        timestamp: now,
      });

      // Get updated report
      const updatedReport = await db.prepare(
        'SELECT * FROM reports WHERE id = ?'
      ).bind(reportId).first();

      logger.info('Moderation action taken', {
        reportId,
        moderatorId,
        action,
        entityType: report.entity_type,
        entityId: report.entity_id
      });

      return {
        success: true,
        result: {
          report: updatedReport,
          contentAction,
        },
      };
    } catch (error) {
      logger.error('Error taking moderation action:', error);
      return c.json({
        success: false,
        error: 'Failed to take moderation action',
      }, 500);
    }
  }

  private async performContentAction(
    c: AppContext,
    entityType: string,
    entityId: string,
    action: string,
    notes?: string
  ): Promise<{ performed: boolean; action: string; notes?: string }> {
    try {
      // Get the appropriate bucket based on entity type
      const bucketMap: Record<string, R2Bucket | undefined> = {
        video: c.env.videos,
        channel: c.env.channels,
        playlist: c.env.playlists,
      };

      const bucket = bucketMap[entityType];
      if (!bucket) {
        logger.warn(`No bucket mapping for entity type: ${entityType}`);
        return {
          performed: false,
          action,
          notes: `Entity type ${entityType} not supported for content actions`,
        };
      }

      const repository = new R2Repository<any>(bucket);
      const entity = await repository.getObject(entityId);

      if (!entity) {
        return {
          performed: false,
          action,
          notes: `${entityType} not found: ${entityId}`,
        };
      }

      switch (action) {
        case 'removed':
          // Mark content as hidden
          const hiddenEntity = {
            ...entity,
            isHidden: true,
            hiddenAt: new Date().toISOString(),
            hiddenByUserId: this.getUserId(c),
            hiddenReason: notes || 'Content removed by moderator',
          };
          await repository.putObject(entityId, hiddenEntity);

          logger.info(`Content hidden: ${entityType}:${entityId}`);
          return {
            performed: true,
            action: 'removed',
            notes: `Content marked as hidden: ${notes || 'Moderation action'}`,
          };

        case 'warning':
          // Add warning flag to content
          const warnedEntity = {
            ...entity,
            hasWarning: true,
            warningAt: new Date().toISOString(),
            warningReason: notes || 'Content flagged for policy violation',
          };
          await repository.putObject(entityId, warnedEntity);

          logger.info(`Warning added to content: ${entityType}:${entityId}`);
          return {
            performed: true,
            action: 'warning',
            notes: `Warning added to content: ${notes || 'Policy violation'}`,
          };

        case 'banned':
          // Mark content as permanently removed
          const bannedEntity = {
            ...entity,
            isDeleted: true,
            deletedAt: new Date().toISOString(),
            isHidden: true,
            hiddenAt: new Date().toISOString(),
            hiddenByUserId: this.getUserId(c),
            hiddenReason: notes || 'Content banned by moderator',
          };
          await repository.putObject(entityId, bannedEntity);

          logger.info(`Content banned: ${entityType}:${entityId}`);
          return {
            performed: true,
            action: 'banned',
            notes: `Content permanently removed: ${notes || 'Severe violation'}`,
          };

        default:
          return {
            performed: false,
            action,
            notes: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      logger.error('Error performing content action:', error);
      return {
        performed: false,
        action,
        notes: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
