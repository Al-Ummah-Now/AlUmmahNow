import { AdminRoute, AppContext } from "../../base";
import { Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { hasContentPermission, reportOutcomeOptions, REPORT_OUTCOMES, type ReportableEntityType } from '@al-ummah/shared-types';
import { ResponseError, ReportSchema, type Report } from "../../lib/types";
import { decidableItem, knownOwner, type DecisionEnv } from '../../lib/moderation/reportDecision';
import { DELETED_USER_ID } from '../../lib/moderation/reportMeta';
import { logger } from "../../lib/logger";

export class ReportGet extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Moderation"],
    summary: "Get Report",
    description: "Get details of a specific report by ID, and the outcomes the reader may choose.",
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
                outcomes: z
                  .array(z.object({ action: z.enum(REPORT_OUTCOMES as [string, ...string[]]), available: z.boolean(), reason: z.enum(['not_for_type', 'not_for_post_comment', 'item_gone', 'permission']).nullable() }))
                  .describe('What the reader may decide about the reported item, and why the rest is not offered'),
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
      ).bind(reportId).first<Report>();

      if (!report) {
        return c.json({
          success: false,
          error: 'Report not found',
        }, 404);
      }

      logger.debug('Report viewed', {
        reportId,
        moderatorId: this.getUserId(c)
      });

      const item = await decidableItem(c.env as DecisionEnv, report.entity_type, report.entity_id);
      const ownerId = item?.found ? item.ownerId : await knownOwner(c.env as DecisionEnv, report.entity_type, report.entity_id);

      return {
        success: true,
        result: {
          report,
          outcomes: reportOutcomeOptions({
            type: report.entity_type as ReportableEntityType,
            item,
            ownerKnown: !!ownerId && ownerId !== DELETED_USER_ID,
            may: (permission) => hasContentPermission(this.getRoles(c), permission),
          }),
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
