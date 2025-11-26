import { AdminRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError, ReportSchema } from "../../lib/types";
import { logger } from "../../lib/logger";

export class ReportGet extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Moderation"],
    summary: "Get Report",
    description: "Get details of a specific report by ID.",
    request: {
      params: z.object({
        reportId: Str({ description: "Report ID" }),
      }),
    },
    responses: {
      "200": {
        description: "Returns the report",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                report: ReportSchema,
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

    try {
      const db = c.env.REPORTS_DB;

      const report = await db.prepare(
        'SELECT * FROM reports WHERE id = ?'
      ).bind(reportId).first();

      if (!report) {
        return c.json({
          success: false,
          error: 'Report not found',
        }, 404);
      }

      logger.info('Report viewed', {
        reportId,
        moderatorId: this.getUserId(c)
      });

      return {
        success: true,
        result: {
          report,
        },
      };
    } catch (error) {
      logger.error('Error getting report:', error);
      return c.json({
        success: false,
        error: 'Failed to get report',
      }, 500);
    }
  }
}
