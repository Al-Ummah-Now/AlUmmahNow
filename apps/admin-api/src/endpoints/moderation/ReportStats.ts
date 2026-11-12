import { AdminRoute, AppContext } from "../../base";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError } from "../../lib/types";
import { logger } from "../../lib/logger";

export class ReportStats extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Moderation"],
    summary: "Get Report Statistics",
    description: "Get moderation statistics including counts by status and entity type.",
    responses: {
      "200": {
        description: "Returns moderation statistics",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                total: z.number(),
                byStatus: z.object({
                  pending: z.number(),
                  reviewing: z.number(),
                  resolved: z.number(),
                  dismissed: z.number(),
                }),
                byEntityType: z.record(z.number()),
                byAction: z.record(z.number()),
                recentActivity: z.object({
                  last24Hours: z.number(),
                  last7Days: z.number(),
                  last30Days: z.number(),
                }),
              }),
            }),
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
    try {
      const db = c.env.REPORTS_DB;

      // Counts by status; the total is their sum. A separate COUNT(*) ran a moment earlier, so a
      // report filed in between made pending + resolved + dismissed exceed the total (DASH-01 on QA,
      // 32,424 vs 32,423 with other runs filing reports)
      const statusResult = await db.prepare(`
        SELECT status, COUNT(*) as count
        FROM reports
        GROUP BY status
      `).all<{ status: string; count: number }>();

      const byStatus = {
        pending: 0,
        reviewing: 0,
        resolved: 0,
        dismissed: 0,
      };
      let total = 0;
      statusResult.results?.forEach(row => {
        total += Number(row.count) || 0;
        if (row.status in byStatus) {
          byStatus[row.status as keyof typeof byStatus] = row.count;
        }
      });

      // Get counts by entity type
      const entityResult = await db.prepare(`
        SELECT entity_type, COUNT(*) as count
        FROM reports
        GROUP BY entity_type
      `).all<{ entity_type: string; count: number }>();

      const byEntityType: Record<string, number> = {};
      entityResult.results?.forEach(row => {
        byEntityType[row.entity_type] = row.count;
      });

      // Get counts by action (for resolved reports)
      const actionResult = await db.prepare(`
        SELECT action, COUNT(*) as count
        FROM reports
        WHERE action IS NOT NULL
        GROUP BY action
      `).all<{ action: string; count: number }>();

      const byAction: Record<string, number> = {};
      actionResult.results?.forEach(row => {
        if (row.action) {
          byAction[row.action] = row.count;
        }
      });

      // Get recent activity
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const activity24h = await db.prepare(
        'SELECT COUNT(*) as count FROM reports WHERE created_at >= ?'
      ).bind(last24Hours).first<{ count: number }>();

      const activity7d = await db.prepare(
        'SELECT COUNT(*) as count FROM reports WHERE created_at >= ?'
      ).bind(last7Days).first<{ count: number }>();

      const activity30d = await db.prepare(
        'SELECT COUNT(*) as count FROM reports WHERE created_at >= ?'
      ).bind(last30Days).first<{ count: number }>();

      logger.debug('Report stats retrieved', {
        moderatorId: this.getUserId(c),
        total: total
      });

      return {
        success: true,
        result: {
          total: total,
          byStatus,
          byEntityType,
          byAction,
          recentActivity: {
            last24Hours: activity24h?.count || 0,
            last7Days: activity7d?.count || 0,
            last30Days: activity30d?.count || 0,
          },
        },
      };
    } catch (error) {
      logger.error('Error getting report stats:', error);
      return c.json({
        success: false,
        error: 'Failed to get report statistics',
      }, 500);
    }
  }
}
