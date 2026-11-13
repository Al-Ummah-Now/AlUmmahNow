/**
 * One check run (cron): probe every component, debounce, store, alert.
 *
 * Alerts reuse the Errors page's needs-action path (critical-only email in
 * production, admin-api lib/errors-alerts.ts): a component that reaches a
 * partial or major outage opens `status:<component>`, and it is resolved
 * when the component is back. No alert during a maintenance window. When the
 * admin API (the Errors ingest) itself is out, the alert is also mailed
 * directly through Resend (production only). Internal components alert the
 * same way; only the public page leaves them out.
 */
import { reportNeedsAction, resolveNeedsAction, STATUS_PAGE_URLS, type ErrorReporterEnv, type ExecutionContextLike } from '@al-ummah/shared-types';
import { runChecks, type CheckDeps, type ComponentResult, type StatusEnvName } from './checks';
import { componentName } from './i18n';
import { logger } from './logger';
import { advance, isOutage, type CheckedState } from './state';
import { isActive, loadIncidents, loadStates, recordRun, type RunWrite } from './store';

export interface StatusEnv extends ErrorReporterEnv {
  STATUS_DB: D1Database;
  ENVIRONMENT: string;
  /** Direct alert mail when the admin API (the Errors ingest) is out (production) */
  RESEND_API_KEY?: string | { get(): Promise<string> };
  ALERT_EMAIL_TO?: string;
  ALERT_EMAIL_FROM?: string;
}

export function statusEnvName(env: { ENVIRONMENT?: string }): StatusEnvName {
  return env.ENVIRONMENT === 'qa' || env.ENVIRONMENT === 'stage' ? env.ENVIRONMENT : 'production';
}

export interface RunOutcome {
  results: ComponentResult[];
  opened: string[];
  resolved: string[];
}

async function secret(binding: StatusEnv['RESEND_API_KEY']): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) ?? '';
  } catch {
    return '';
  }
}

async function mailDirect(env: StatusEnv, subject: string, body: string, fetchImpl: typeof fetch): Promise<void> {
  if (env.ENVIRONMENT !== 'production' || !env.ALERT_EMAIL_TO) return;
  const key = await secret(env.RESEND_API_KEY);
  if (!key) return;
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.ALERT_EMAIL_FROM || 'Al Ummah Now <support@alummahnow.net>', to: [env.ALERT_EMAIL_TO], subject, text: body }),
    });
    if (!res.ok) logger.error('[status] Direct alert mail failed', { status: res.status });
  } catch (error) {
    logger.error('[status] Direct alert mail failed', { error });
  }
}

export async function runOnce(env: StatusEnv, ctx: ExecutionContextLike | undefined, now: Date, deps: CheckDeps): Promise<RunOutcome> {
  const envName = statusEnvName(env);
  const at = now.toISOString();
  const [results, states, incidents] = await Promise.all([runChecks(envName, deps), loadStates(env.STATUS_DB), loadIncidents(env.STATUS_DB, now, 0)]);
  const maintenance = new Set(incidents.filter((i) => i.kind === 'maintenance' && isActive(i, now)).flatMap((i) => i.components));
  const writes: RunWrite[] = [];
  const opened: string[] = [];
  const resolved: string[] = [];
  for (const result of results) {
    const prev = states.get(result.component) ?? null;
    const { next } = advance(prev, result.raw, at);
    const inMaint = maintenance.has(result.component);
    const wasOpen = prev?.alert_open === 1;
    let alertOpen = wasOpen;
    if (isOutage(next.state) && !wasOpen && !inMaint) {
      alertOpen = true;
      opened.push(result.component);
    } else if (!isOutage(next.state) && wasOpen) {
      alertOpen = false;
      resolved.push(result.component);
    }
    const bucket: RunWrite['bucket'] = result.raw === 'unknown' ? 'unknown' : inMaint ? 'maintenance' : (next.state as CheckedState);
    writes.push({ result, next, alertOpen, bucket });
  }
  await recordRun(env.STATUS_DB, writes, at);

  const page = STATUS_PAGE_URLS[envName];
  const adminOut = writes.some((w) => w.result.component === 'admin-api' && isOutage(w.next.state));
  for (const id of opened) {
    const w = writes.find((x) => x.result.component === id)!;
    const title = `Status: ${componentName('en', id)} ${w.next.state === 'major' ? 'is down' : 'has a partial outage'}`;
    reportNeedsAction('status', env, ctx, {
      key: `status:${id}`,
      source: 'status',
      title,
      message: `${title} (${env.ENVIRONMENT}). ${w.result.detail}`,
      itemType: 'status-component',
      itemId: id,
      itemUrl: '/status',
    }, deps.fetch);
    if (adminOut) ctx?.waitUntil(mailDirect(env, `[Al Ummah Now] ${title}`, `${title} since ${w.next.since}.\n\n${w.result.detail}\n\n${page}`, deps.fetch));
  }
  if (resolved.length) resolveNeedsAction(env, ctx, resolved.map((id) => `status:${id}`), deps.fetch);
  return { results, opened, resolved };
}
