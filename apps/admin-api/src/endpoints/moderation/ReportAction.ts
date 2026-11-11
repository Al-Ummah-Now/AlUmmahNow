import { decide, DecisionError, type DecisionEnv } from '../../lib/moderation/reportDecision';
import { AdminRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError, ReportSchema, Report } from "../../lib/types";
import { logger } from "../../lib/logger";

const ActionInput = z.object({
  // banned: ban the content's owner (needs users:manage) and hide the content; deleted: remove the content permanently
  action: z.enum(['warning', 'removed', 'banned', 'deleted', 'dismissed']),
  notes: Str({ description: "Moderator notes" }).optional(),
});

export class ReportAction extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Moderation"],
    summary: "Take Moderation Action",
    description: "Take action on a reported content item. Updates the report status and applies the action: warning, removed (hide), banned (ban the owner, as Users → Ban, and hide; needs users:manage), deleted (remove permanently) or dismissed.",
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
      "403": {
        description: "The outcome needs a permission the role lacks (banned: users:manage)",
        content: {
          "application/json": {
            schema: ResponseError,
          },
        },
      },
      "409": {
        description: "Report already closed",
        content: {
          "application/json": {
            schema: ResponseError,
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
      "503": {
        description: "The content could not be changed; the report is open again",
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

      const report = await db.prepare(
        'SELECT * FROM reports WHERE id = ?'
      ).bind(reportId).first<Report>();

      if (!report) {
        return c.json({
          success: false,
          error: 'Report not found',
        }, 404);
      }

      if (report.status !== 'pending' && report.status !== 'reviewing') {
        logger.debug('Moderation action rejected: report already closed', {
          reportId,
          status: report.status,
          moderatorId,
        });
        return c.json({
          success: false,
          error: `Report is already ${report.status}`,
        }, 409);
      }

      // Same decision path as the reports queue (lib/moderation/reportDecision.ts):
      // `banned` bans the owner through the user ban (users:manage, audited)
      const outcome = await decide(c.env as DecisionEnv, {
        reports: [report],
        action,
        notes: notes ?? null,
        actorId: moderatorId,
        roles: this.getRoles(c),
      });

      const updatedReport = await db.prepare(
        'SELECT * FROM reports WHERE id = ?'
      ).bind(reportId).first();

      return {
        success: true,
        result: {
          report: updatedReport,
          contentAction: outcome.contentAction,
        },
      };
    } catch (error) {
      if (error instanceof DecisionError) {
        if (error.status === 403) logger.warn('Moderation action refused: permission', { reportId, moderatorId, action });
        return c.json({ success: false, code: error.code, error: error.message }, error.status);
      }
      logger.error('Error taking moderation action:', error);
      return c.json({
        success: false,
        error: 'Failed to take moderation action',
      }, 500);
    }
  }
}
