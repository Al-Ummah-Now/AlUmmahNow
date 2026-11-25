/**
 * "Start review": a moderator marks an open report as under review, or puts it back (#2015). While a report
 * about a channel is under review its owner can't hand the channel over (routers/channelReports.router.ts,
 * wiki AUN-CHANNEL-CLAIM §5). A pending report alone blocks nothing: anyone can file one.
 */
import { dropAudit, writeAudit, type ContentKind } from '../content/audit';
import { DecisionError } from './reportDecision';
import { hiddenFrom } from './takedown';
import { logger } from '../logger';
import type { Report } from '../types';

/** The item whose history keeps it. */
const AUDIT_KIND: Record<Report['entity_type'], ContentKind> = { video: 'video', channel: 'channel', playlist: 'playlist', post: 'post', comment: 'comment', livestream: 'live-stream', live_chat: 'live-stream' };

export async function setReportReview(db: D1Database, reportId: string, reviewing: boolean, actorId: string, roles?: readonly unknown[]): Promise<Report> {
  const read = () => db.prepare('SELECT * FROM reports WHERE id = ?').bind(reportId).first<Report>();
  const report = await read();
  if (!report) throw new DecisionError(404, 'not_found', 'Report not found');
  if ((await hiddenFrom(db as never, roles, [{ type: report.entity_type, id: report.entity_id }])).size > 0) {
    throw new DecisionError(403, 'forbidden', 'The item is under a takedown; only super admins act on it');
  }
  const [from, to] = reviewing ? (['pending', 'reviewing'] as const) : (['reviewing', 'pending'] as const);
  // As it is asked to be already (a second click, another moderator): nothing to change or record
  if (report.status === to) return report;
  const closed = () => new DecisionError(409, 'already_closed', 'Report is already closed');
  if (report.status !== from) throw closed();
  const at = new Date().toISOString();
  const audit = await writeAudit(db as never, {
    kind: AUDIT_KIND[report.entity_type] ?? 'live-stream',
    id: report.entity_id,
    action: reviewing ? 'report-review-start' : 'report-review-stop',
    actorId,
    details: { reportId, reason: report.reason },
    previous: { status: from },
  }, at);
  try {
    // Only an open report moves; the copy of the moderator's name is refreshed
    const moved = await db
      .prepare('UPDATE reports SET status = ?, moderator_id = ?, moderator_name = NULL, updated_at = ?, meta_synced_at = NULL WHERE id = ? AND status = ?')
      .bind(to, reviewing ? actorId : null, at, reportId, from)
      .run();
    const now = await read();
    if (((moved.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) {
      // Another moderator's change came first: theirs is recorded
      await dropAudit(db as never, audit);
      if (now?.status === to) return now;
      throw closed();
    }
    logger.info('[Moderation] Report review', { reportId, entityType: report.entity_type, entityId: report.entity_id, status: to, actorId });
    return now!;
  } catch (error) {
    if (!(error instanceof DecisionError)) await dropAudit(db as never, audit).catch(() => undefined);
    throw error;
  }
}
