/**
 * New-error and spike alerts for the admin Errors page (critical kinds only,
 * see isAlertWorthy), emailed to the
 * admin notification address (ERRORS_ALERT_TO, else the support inbox
 * CONTACT_INBOX). Production only, never for the release E2E's test errors,
 * at most one alert per group every 6 hours and ERROR_ALERT_LIMITS.perHour
 * mails per hour in all (the rest are recorded in the group's activity only).
 */
import { sendContactEmail, type MailerEnv, type RenderedEmail } from './contact-email';
import { renderEmail, type EmailDoc } from './email/layout';
import { bumpRate, recordAlert, type ErrorGroupRow, type IngestOutcome } from './errors-store';
import { logger } from './logger';
import type { D1Database } from './types';

export const ERROR_ALERT_LIMITS = {
  perHour: 10,
  perGroupHours: 6,
} as const;

const SERVER_APPS = new Set(['api-videos', 'admin-api', 'processor', 'scheduler', 'websocket']);

/**
 * Only failures that need someone to act are emailed: a server answering 5xx,
 * a crash a user actually saw (error page), a crash in a Worker, and
 * "needs action" items. Problems the page handled itself (caught, fetch,
 * player, upload, chunk, skew) and browser-side rejections are listed on the
 * Errors page only, never mailed.
 */
export function isAlertWorthy(group: Pick<ErrorGroupRow, 'kind' | 'app'>): boolean {
  if (group.kind === 'http' || group.kind === 'boundary' || group.kind === 'action') return true;
  if (group.kind === 'unhandled' || group.kind === 'rejection') return SERVER_APPS.has(group.app);
  return false;
}

export interface AlertEnv extends MailerEnv {
  ERRORS_ALERT_TO?: string;
  CONTACT_INBOX?: string;
  ADMIN_WEB_URL?: string;
}

export function alertRecipient(env: AlertEnv): string | null {
  return env.ERRORS_ALERT_TO?.trim() || env.CONTACT_INBOX?.trim() || null;
}

export function renderErrorAlert(group: ErrorGroupRow, reason: 'new' | 'spike', opts: { to: string; adminUrl?: string; environment?: string }): RenderedEmail {
  const link = opts.adminUrl ? `${opts.adminUrl.replace(/\/$/, '')}/errors/${encodeURIComponent(group.id)}` : null;
  const what = reason === 'new' ? 'New error' : 'Error spike';
  const env = opts.environment && opts.environment !== 'production' ? `[${opts.environment}] ` : '';
  const title = group.message.length > 90 ? `${group.message.slice(0, 89)}…` : group.message;
  const subject = `${env}${what} in ${group.app}: ${title}`;
  const facts: [string, string][] = [
    ['App', group.app],
    ['Environment', group.environment],
    ['Kind', group.kind],
    ['Where', group.culprit || group.route || '-'],
    ['Occurrences', String(group.occurrences)],
    ['Users affected', String(group.users)],
    ['Release', group.last_release || '-'],
    ['First seen', group.first_seen],
  ];
  const doc: EmailDoc = {
    locale: 'en',
    subject,
    preheader: `${group.occurrences} occurrence${group.occurrences === 1 ? '' : 's'}, ${group.users} user${group.users === 1 ? '' : 's'} affected in ${group.environment}.`,
    heading: `${what} in ${group.app} (${group.environment})`,
    blocks: [
      { kind: 'notice', tone: 'warning', text: `${group.name || 'Error'}: ${group.message}` },
      { kind: 'facts', rows: facts },
    ],
    ...(link ? { cta: { label: 'Open in the admin Errors page', url: link } } : {}),
    reason: `You got this email because this address receives Al Ummah Now error alerts (ERRORS_ALERT_TO, else the support inbox). Spike alerts for one error repeat at most every ${ERROR_ALERT_LIMITS.perGroupHours} hours.`,
  };
  return { to: opts.to, ...renderEmail(doc) };
}

/** Sends the alerts an ingest batch earned. Never throws. */
export async function sendErrorAlerts(db: D1Database, env: AlertEnv, outcome: IngestOutcome, now: Date, fetchImpl?: typeof fetch): Promise<number> {
  if (env.ENVIRONMENT !== 'production') return 0;
  const to = alertRecipient(env);
  if (!to) return 0;
  const candidates: [ErrorGroupRow, 'new' | 'spike'][] = [
    ...outcome.created.filter((g) => !g.test && isAlertWorthy(g)).map((g) => [g, 'new'] as [ErrorGroupRow, 'new']),
    ...outcome.spiking
      .filter((g) => !g.test && g.status !== 'ignored' && isAlertWorthy(g))
      .filter((g) => !g.last_alert_at || now.getTime() - Date.parse(g.last_alert_at) > ERROR_ALERT_LIMITS.perGroupHours * 3600_000)
      .map((g) => [g, 'spike'] as [ErrorGroupRow, 'spike']),
  ];
  let sent = 0;
  for (const [group, reason] of candidates) {
    try {
      const hour = now.toISOString().slice(0, 13);
      const n = await bumpRate(db, `alert:${hour}`, new Date(now.getTime() + 2 * 3600_000));
      if (n > ERROR_ALERT_LIMITS.perHour) {
        await recordAlert(db, group.id, `${reason === 'new' ? 'New error' : 'Spike'}: alert not mailed (hourly limit)`, now);
        continue;
      }
      const result = await sendContactEmail(env, renderErrorAlert(group, reason, { to, adminUrl: env.ADMIN_WEB_URL, environment: env.ENVIRONMENT }), {
        idempotencyKey: `error-alert-${group.id}-${reason}-${hour}`,
        fetchImpl,
      });
      await recordAlert(db, group.id, `${reason === 'new' ? 'New error' : 'Spike'} alert to ${to}: ${result.status}`, now);
      if (result.status === 'sent') sent += 1;
      else logger.warn('[Errors] Alert not sent', { group: group.id, status: result.status, error: result.error });
    } catch (error) {
      logger.error('[Errors] Alert failed', { group: group.id, error: String(error) });
    }
  }
  return sent;
}
