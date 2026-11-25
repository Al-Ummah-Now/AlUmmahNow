import { AdminRoute, AppContext } from "../../base";
import { Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { hasContentPermission, isSuperAdmin, reportOutcomeOptions, REPORT_OUTCOMES, type ReportableEntityType } from '@al-ummah/shared-types';
import { ResponseError, ReportSchema, type Report } from "../../lib/types";
import { knownOwner, type DecisionEnv } from '../../lib/moderation/reportDecision';
import { reportIntakeUrl } from '../../lib/moderation/intakeUrl';
import { itemSummary, type ItemCopy } from '../../lib/moderation/reportQueue';
import { DELETED_USER_ID, itemKey, lookupMany } from '../../lib/moderation/reportMeta';
import { hiddenFrom, withheldSummary, withoutCopies } from '../../lib/moderation/takedown';
import { videosWebOrigin } from '../../lib/invites';
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
                item: z.any().describe('The reported item as it is now (ReportedItemSummary): title or text, channel, owner, found or gone'),
                intake: z
                  .object({ url: z.string().nullable(), evidence: z.boolean() })
                  .nullable()
                  .describe('Super admins, child safety reports: the page that opens a case for exactly this item (null: none does), and whether a sealed copy of its records was kept'),
                outcomes: z
                  .array(z.object({ action: z.enum(REPORT_OUTCOMES as [string, ...string[]]), available: z.boolean(), reason: z.enum(['not_for_type', 'not_for_post_comment', 'item_gone', 'permission', 'taken_down']).nullable() }))
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

      const type = report.entity_type as ReportableEntityType;
      const lookup = await lookupMany(c.env as DecisionEnv, [{ type, id: report.entity_id }], [report.reporter_id, report.owner_id ?? '']);
      const live = lookup?.items.get(itemKey(type, report.entity_id)) ?? null;
      const ownerId = live?.found ? live.ownerId : await knownOwner(c.env as DecisionEnv, type, report.entity_id);
      const withheld = (await hiddenFrom(db as never, this.getRoles(c), [{ type, id: report.entity_id }])).size > 0;
      const summary = itemSummary(report as unknown as ItemCopy, lookup);
      const item = withheld ? withheldSummary(summary) : summary;
      let intake: { url: string | null; evidence: boolean } | null = null;
      if (report.reason === 'child_safety' && isSuperAdmin(this.getRoles(c))) {
        const alert = await db.prepare('SELECT evidence FROM child_safety_alerts WHERE entity_type = ? AND entity_id = ?').bind(type, report.entity_id).first<{ evidence: string | null }>();
        intake = { url: reportIntakeUrl(videosWebOrigin(c.env), { type, id: report.entity_id, live }), evidence: alert?.evidence === 'kept' };
      }

      return {
        success: true,
        result: {
          report: withheld ? withoutCopies(report) : report,
          item,
          intake,
          outcomes: reportOutcomeOptions({
            type,
            item: live,
            ownerKnown: !!ownerId && ownerId !== DELETED_USER_ID,
            takenDown: withheld,
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
