import { AdminRoute, AppContext } from "../../base";
import { Num } from "../../lib/chanfana-params";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError, ReportSchema } from "../../lib/types";
import { REPORT_REASONS } from "@al-ummah/shared-types";
import { listReports } from "../../lib/moderation/reportList";
import type { D1Database } from "../../lib/types";
import { hiddenFrom, isHiddenItem, withoutCopies } from "../../lib/moderation/takedown";
import { logger } from "../../lib/logger";

export class ReportsList extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Moderation"],
    summary: "List Reports",
    description: "List all reports with optional filtering by status, entity type, or date range.",
    request: {
      query: z.object({
        status: z.enum(['pending', 'reviewing', 'resolved', 'dismissed']).optional(),
        entity_type: z.enum(['video', 'comment', 'channel', 'livestream', 'playlist', 'post', 'live_chat']).optional(),
        reason: z.enum(REPORT_REASONS).optional(),
        entity_id: z.string().trim().min(1).max(200).optional().describe("Only reports about this item (the admin picks it by name)"),
        reporter_id: z.string().trim().min(1).max(200).optional().describe("Only reports filed by this user"),
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
                total: z.number().describe('Reports under the filters, counted up to 1000'),
                totalCapped: z.boolean().describe('There are more than `total`'),
                openChildSafety: z.number().describe('Open child safety reports in all, counted up to 1000'),
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
    const { status, entity_type, reason, entity_id, reporter_id, limit, offset } = request.query;

    try {
      const db = c.env.REPORTS_DB as unknown as D1Database;
      const pageSize = Math.min(limit || 50, 100);
      const page = await listReports(db, { status, entity_type, reason, entity_id, reporter_id }, pageSize, offset || 0);

      const hidden = await hiddenFrom(db, this.getRoles(c), page.reports.map((r) => ({ type: r.entity_type, id: r.entity_id })));

      logger.debug('Reports listed', {
        moderatorId: this.getUserId(c),
        filters: { status, entity_type, reason, entity: !!entity_id, reporter: !!reporter_id },
        count: page.reports.length
      });

      return {
        success: true,
        result: { ...page, reports: page.reports.map((r) => (isHiddenItem(hidden, r.entity_type, r.entity_id) ? withoutCopies(r) : r)), limit: pageSize, offset: offset || 0 },
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
