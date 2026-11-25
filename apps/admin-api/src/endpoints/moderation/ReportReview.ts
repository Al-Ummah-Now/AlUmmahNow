import { z } from 'zod';
import { AdminRoute, AppContext } from '../../base';
import { Str } from '../../lib/chanfana-params';
import { apiError } from '../../lib/api-error';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { DecisionError } from '../../lib/moderation/reportDecision';
import { setReportReview } from '../../lib/moderation/reportReview';
import { ReportSchema, ResponseError } from '../../lib/types';

const error = (description: string) => ({ description, content: { 'application/json': { schema: ResponseError } } });

export class ReportReview extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['Moderation'],
    summary: 'Start or stop reviewing a report',
    description: 'Marks an open report as under review (`reviewing: true`), or puts it back to pending. While a report about a channel is under review, its owner can’t hand the channel over. Audited.',
    request: {
      params: z.object({ reportId: Str({ description: 'Report ID' }) }),
      body: { content: { 'application/json': { schema: z.object({ reviewing: z.boolean() }) } } },
    },
    responses: {
      '200': { description: 'The report as it is now', content: { 'application/json': { schema: z.object({ success: z.boolean().default(true), result: z.object({ report: ReportSchema }) }) } } },
      '403': error('The item is under a takedown; only super admins act on it'),
      '404': error('Report not found'),
      '409': error('already_closed: the report was resolved or dismissed'),
      '500': error('Internal server error'),
    },
  });

  async handle(c: AppContext) {
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const actorId = this.getUserId(c);
    try {
      return { success: true, result: { report: await setReportReview(c.env.REPORTS_DB as never, params.reportId, body.reviewing, actorId, this.getRoles(c)) } };
    } catch (err) {
      if (err instanceof DecisionError) return apiError(c, err.status, err.code, { error: err.message });
      logger.error('[Moderation] Report review failed', { reportId: params.reportId, reviewing: body.reviewing, actorId, error: err instanceof Error ? err.message : String(err) });
      return apiError(c, 500, 'internal_error');
    }
  }
}
