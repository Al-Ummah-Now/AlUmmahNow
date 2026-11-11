import { AdminRoute, AppContext } from "../../base";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError } from "../../lib/types";
import { logger } from "../../lib/logger";
import { computeReportStats } from "../../lib/report-stats";

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
      const result = await computeReportStats(c.env.REPORTS_DB);
      logger.debug('Report stats retrieved', { moderatorId: this.getUserId(c), total: result.total });
      return { success: true, result };
    } catch (error) {
      logger.error('Error getting report stats:', error);
      return c.json({
        success: false,
        error: 'Failed to get report statistics',
      }, 500);
    }
  }
}
