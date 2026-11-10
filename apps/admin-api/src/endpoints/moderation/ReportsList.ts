import { AdminRoute, AppContext } from "../../base";
import { Num } from "chanfana";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError, ReportSchema } from "../../lib/types";
import { logger } from "../../lib/logger";

export class ReportsList extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Moderation"],
    summary: "List Reports",
    description: "List all reports with optional filtering by status, entity type, or date range.",
    request: {
      query: z.object({
        status: z.enum(['pending', 'reviewing', 'resolved', 'dismissed']).optional(),
        entity_type: z.enum(['video', 'comment', 'channel', 'livestream', 'playlist', 'post']).optional(),
        limit: Num({ description: "Number of reports to return (max 100)" }).optional().default(50),
        offset: Num({ description: "Offset for pagination" }).optional().default(0),
      }),
    },
    responses: {
      "200": {
        description: "Returns list of reports",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().default(true),
              result: z.object({
                reports: z.array(ReportSchema),
                total: z.number(),
                limit: z.number(),
                offset: z.number(),
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
    const request = await this.getValidatedData<typeof this.schema>();
    const { status, entity_type, limit, offset } = request.query;

    try {
      const db = c.env.REPORTS_DB;

      // Build query with optional filters
      let query = 'SELECT * FROM reports';
      const conditions: string[] = [];
      const params: any[] = [];

      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }

      if (entity_type) {
        conditions.push('entity_type = ?');
        params.push(entity_type);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC';
      query += ` LIMIT ${Math.min(limit || 50, 100)} OFFSET ${offset || 0}`;

      // Get reports
      const stmt = db.prepare(query);
      const boundStmt = params.length > 0 ? stmt.bind(...params) : stmt;
      const result = await boundStmt.all();

      // Get total count
      let countQuery = 'SELECT COUNT(*) as count FROM reports';
      if (conditions.length > 0) {
        countQuery += ' WHERE ' + conditions.join(' AND ');
      }
      const countStmt = db.prepare(countQuery);
      const boundCountStmt = params.length > 0 ? countStmt.bind(...params) : countStmt;
      const countResult = await boundCountStmt.first<{ count: number }>();

      logger.debug('Reports listed', {
        moderatorId: this.getUserId(c),
        filters: { status, entity_type },
        count: result.results?.length || 0
      });

      return {
        success: true,
        result: {
          reports: result.results || [],
          total: countResult?.count || 0,
          limit: Math.min(limit || 50, 100),
          offset: offset || 0,
        },
      };
    } catch (error) {
      logger.error('Error listing reports:', error);
      return c.json({
        success: false,
        error: 'Failed to list reports',
      }, 500);
    }
  }
}
