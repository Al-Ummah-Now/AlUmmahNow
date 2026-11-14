/**
 * One hourly run: query the last 3 complete hours (idempotent; covers the
 * analytics lag), upsert ops_hourly, roll up today (and yesterday right after
 * midnight), check thresholds. One GraphQL request per run.
 */
import { reportNeedsAction, resolveNeedsAction, type ErrorReporterEnv, type ExecutionContextLike } from '@al-ummah/shared-types';
import { ManifestIndex, manifestFor, mergeResources, parseEnvs, type OpsEnv, type Resource } from './manifest';
import { DISCOVERY_MAX_AGE_MS, discoverResources, loadDiscovered, storeDiscovered } from './discover';
import { queryVariables, runOpsQuery } from './graphql';
import { normalize } from './normalize';
import { finishRun, prune, rollupDay, startRun, upsertHourly } from './store';
import { alertTitle, evaluateThresholds, formatValue, type ThresholdChange } from './thresholds';
import { logger } from './logger';

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface CollectorEnv extends ErrorReporterEnv {
  COSTS_DB: D1Database;
  /** Account Analytics Read (Secrets Store media-cdn-api-token until al-ummah-cost-monitor-read exists). */
  CF_ANALYTICS_TOKEN?: SecretBinding;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Envs this deployment collects: production collects all three, QA and stage only themselves. */
  COLLECT_ENVS?: string;
  LOG_LEVEL?: string;
}

export const WINDOW_HOURS = 3;

export async function secretValue(binding: SecretBinding): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) ?? '';
  } catch {
    return '';
  }
}

export function hourStart(d: Date): Date {
  const h = new Date(d);
  h.setUTCMinutes(0, 0, 0);
  return h;
}

/**
 * Where the admin live layer publishes `admin:ops` (docs/admin/LIVE_OPS.md
 * §B.2). Until that publisher is wired in, an alert reaches admins through
 * its Errors page item, which this run reports below.
 */
export async function onThresholdChange(change: ThresholdChange, env: CollectorEnv): Promise<void> {
  logger.debug('[ops] Threshold change', { key: change.key, state: change.state, env: change.env, environment: env.ENVIRONMENT });
}

function reportChange(change: ThresholdChange, env: CollectorEnv, ctx: ExecutionContextLike | undefined, fetchImpl: typeof fetch): void {
  if (change.state === 'resolved') {
    resolveNeedsAction(env, ctx, change.key, fetchImpl);
    return;
  }
  reportNeedsAction('cost-monitor', env, ctx, {
    key: change.key,
    source: 'ops',
    title: alertTitle(change.rule),
    message: `${change.name} (${change.env}): ${formatValue(change.rule, change.value)} ${change.rule.op} ${formatValue(change.rule, change.rule.value)} over ${change.rule.window_hours}h`,
    itemType: 'ops-resource',
    itemId: change.resourceId,
    itemUrl: `/operations?env=${change.env}`,
  }, fetchImpl);
}

/**
 * The resources this run collects: the static manifest plus what discovery stored. Discovers again
 * when the stored set is empty or older than DISCOVERY_MAX_AGE_MS (or `force`); a failed listing
 * keeps the stored set and is returned as `error` (recorded in the run's detail).
 */
export async function resourcesFor(
  env: CollectorEnv,
  token: string,
  envs: OpsEnv[],
  now: Date,
  fetchImpl: typeof fetch,
  force = false,
): Promise<{ resources: Resource[]; discovered: number; refreshed: boolean; error?: string }> {
  const stored = await loadDiscovered(env.COSTS_DB, envs);
  let found = stored.resources;
  let refreshed = false;
  let error: string | undefined;
  const stale = !stored.refreshedAt || now.getTime() - Date.parse(stored.refreshedAt) > DISCOVERY_MAX_AGE_MS;
  if (force || stale) {
    try {
      found = await discoverResources(token, env.CLOUDFLARE_ACCOUNT_ID ?? '', envs, fetchImpl);
      await storeDiscovered(env.COSTS_DB, found, now);
      refreshed = true;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      logger.warn('[ops] Resource discovery failed; using the stored set', { error, stored: stored.resources.length });
    }
  }
  return { resources: mergeResources(manifestFor(envs), found), discovered: found.length, refreshed, ...(error ? { error } : {}) };
}

export interface HourlyOutcome {
  status: 'ok' | 'partial' | 'failed';
  queries: number;
  rows: number;
  dropped: number;
  changes: number;
}

export async function runHourly(env: CollectorEnv, ctx: ExecutionContextLike | undefined, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<HourlyOutcome> {
  const startedAt = Date.now();
  const envs: OpsEnv[] = parseEnvs(env.COLLECT_ENVS);
  const runId = await startRun(env.COSTS_DB, 'hourly', now);
  const outcome: HourlyOutcome = { status: 'ok', queries: 0, rows: 0, dropped: 0, changes: 0 };
  const detail: Record<string, unknown> = { envs };
  try {
    const token = await secretValue(env.CF_ANALYTICS_TOKEN);
    if (!token || !env.CLOUDFLARE_ACCOUNT_ID || envs.length === 0) throw new Error('collector is not configured (token, account id or COLLECT_ENVS missing)');
    const scope = await resourcesFor(env, token, envs, now, fetchImpl);
    detail.resources = scope.resources.length;
    // A failed listing (e.g. a token without list access) keeps the static manifest and the stored
    // set; it is recorded, not a partial run, so a standing permission gap cannot mask real gaps
    if (scope.error) detail.discovery = scope.error;
    const index = new ManifestIndex(scope.resources);
    const end = hourStart(now);
    const start = new Date(end.getTime() - WINDOW_HOURS * 3_600_000);
    outcome.queries = 1;
    const result = await runOpsQuery(token, queryVariables(env.CLOUDFLARE_ACCOUNT_ID, index, start, end), fetchImpl);
    if (result.errors.length) {
      outcome.status = 'partial';
      detail.errors = result.errors.slice(0, 5);
    }
    const { rows, dropped } = normalize(result.data, index);
    outcome.dropped = dropped;
    outcome.rows = await upsertHourly(env.COSTS_DB, rows, now);
    const today = end.toISOString().slice(0, 10);
    await rollupDay(env.COSTS_DB, today, now);
    const firstHour = start.toISOString().slice(0, 10);
    if (firstHour !== today) await rollupDay(env.COSTS_DB, firstHour, now);

    const changes = await evaluateThresholds(env.COSTS_DB, end, now);
    outcome.changes = changes.length;
    for (const change of changes) {
      reportChange(change, env, ctx, fetchImpl);
      await onThresholdChange(change, env);
    }
  } catch (error) {
    outcome.status = 'failed';
    detail.error = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
    logger.error('[ops] Hourly collection failed', { error: detail.error });
  }
  await finishRun(env.COSTS_DB, runId, { status: outcome.status, queries: outcome.queries, rowsWritten: outcome.rows, detail: { ...detail, dropped: outcome.dropped, changes: outcome.changes } }, new Date());
  logger.job({ job: 'ops.hourly', outcome: outcome.status, durationMs: Date.now() - startedAt, rows: outcome.rows, queries: outcome.queries, changes: outcome.changes });
  return outcome;
}

/** Daily: resource discovery, final rollup of yesterday, retention. */
export async function runDaily(env: CollectorEnv, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<{ rolled: number; pruned: number; discovered: number }> {
  const runId = await startRun(env.COSTS_DB, 'daily', now);
  let rolled = 0;
  let pruned = 0;
  let discovered = 0;
  let status: 'ok' | 'failed' = 'ok';
  try {
    const token = await secretValue(env.CF_ANALYTICS_TOKEN);
    const envs = parseEnvs(env.COLLECT_ENVS);
    if (token && env.CLOUDFLARE_ACCOUNT_ID && envs.length) {
      const scope = await resourcesFor(env, token, envs, now, fetchImpl, true);
      discovered = scope.discovered;
    }
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    rolled = await rollupDay(env.COSTS_DB, yesterday, now);
    pruned = await prune(env.COSTS_DB, now);
  } catch (error) {
    status = 'failed';
    logger.error('[ops] Daily rollup failed', { error: error instanceof Error ? error.message : String(error) });
  }
  await finishRun(env.COSTS_DB, runId, { status, queries: 0, rowsWritten: rolled, detail: { pruned, discovered } }, new Date());
  return { rolled, pruned, discovered };
}
