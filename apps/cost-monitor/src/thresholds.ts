/**
 * Threshold alerts (docs/admin/LIVE_OPS.md §A.4). After each hourly run the
 * enabled rules in ops_thresholds are checked against ops_hourly. A crossing
 * becomes an Errors page needs-action item (key `ops:<rule>:<resource>`,
 * source 'ops') once; it is resolved when the metric recovers. Every open and
 * resolve also goes through onThresholdChange, where the admin live layer
 * publishes its `admin:ops` event.
 */
import type { OpsEnv, ResourceKind } from './manifest';

export interface ThresholdRule {
  id: string;
  kind: ResourceKind;
  metric: 'error_rate' | 'cpu_p99' | 'latency_p99' | 'backlog_max' | 'dlq_backlog';
  op: '>' | '<';
  value: number;
  window_hours: number;
}

export interface WindowStats {
  resource_id: string;
  kind: ResourceKind;
  env: OpsEnv;
  name: string;
  requests: number | null;
  errors: number | null;
  cpu_p99: number | null;
  latency_p99: number | null;
  backlog_max: number | null;
}

/** Fewer requests than this in the window and the error rate is not judged (noise). */
export const MIN_REQUESTS_FOR_ERROR_RATE = 100;

export interface ThresholdChange {
  state: 'open' | 'resolved';
  key: string;
  rule: ThresholdRule;
  resourceId: string;
  env: string;
  name: string;
  value: number | null;
}

const isDlq = (name: string) => /-dlq(-qa|-stage)?$/.test(name);

/** The rule's value for a resource over its window, or null when the rule does not apply. */
export function metricValue(rule: ThresholdRule, s: WindowStats): number | null {
  if (s.kind !== rule.kind) return null;
  switch (rule.metric) {
    case 'error_rate':
      if (!s.requests || s.requests < MIN_REQUESTS_FOR_ERROR_RATE) return null;
      return (s.errors ?? 0) / s.requests;
    case 'cpu_p99':
      return s.cpu_p99;
    case 'latency_p99':
      return s.latency_p99;
    case 'backlog_max':
      return isDlq(s.name) ? null : s.backlog_max;
    case 'dlq_backlog':
      return isDlq(s.name) ? s.backlog_max : null;
  }
}

export function crosses(rule: ThresholdRule, value: number | null): boolean {
  if (value === null) return false;
  return rule.op === '>' ? value > rule.value : value < rule.value;
}

export const alertKey = (ruleId: string, resourceId: string) => `ops:${ruleId}:${resourceId}`;

async function windowStats(db: D1Database, hours: number, end: Date): Promise<WindowStats[]> {
  const from = new Date(end.getTime() - hours * 3_600_000).toISOString().replace('.000Z', 'Z');
  const to = end.toISOString().replace('.000Z', 'Z');
  const { results } = await db
    .prepare(
      `SELECT resource_id, kind, env, name, SUM(requests) AS requests, SUM(errors) AS errors, MAX(cpu_p99) AS cpu_p99,
         MAX(latency_p99) AS latency_p99, MAX(backlog_max) AS backlog_max
       FROM ops_hourly WHERE hour >= ? AND hour < ? GROUP BY resource_id, kind, env, name`,
    )
    .bind(from, to)
    .all<WindowStats>();
  return results ?? [];
}

/**
 * Checks every enabled rule; returns the alerts opened and resolved in this run.
 * `end` is the start of the current (incomplete) hour: windows end there.
 */
export async function evaluateThresholds(db: D1Database, end: Date, now: Date): Promise<ThresholdChange[]> {
  const rules = (await db.prepare('SELECT id, kind, metric, op, value, window_hours FROM ops_thresholds WHERE enabled = 1').all<ThresholdRule>()).results ?? [];
  const open = new Map(
    ((await db.prepare('SELECT key, rule_id, resource_id, env FROM ops_alerts').all<{ key: string; rule_id: string; resource_id: string; env: string }>()).results ?? []).map((a) => [a.key, a]),
  );
  const changes: ThresholdChange[] = [];
  const stamp = now.toISOString();
  const statsByWindow = new Map<number, WindowStats[]>();
  const seen = new Set<string>();

  for (const rule of rules) {
    const hours = Math.min(Math.max(1, rule.window_hours || 1), 72);
    if (!statsByWindow.has(hours)) statsByWindow.set(hours, await windowStats(db, hours, end));
    for (const s of statsByWindow.get(hours)!) {
      const value = metricValue(rule, s);
      if (value === null) continue;
      const key = alertKey(rule.id, s.resource_id);
      seen.add(key);
      if (crosses(rule, value)) {
        if (open.has(key)) {
          await db.prepare('UPDATE ops_alerts SET value = ?, last_seen_at = ? WHERE key = ?').bind(value, stamp, key).run();
        } else {
          await db
            .prepare('INSERT INTO ops_alerts (key, rule_id, resource_id, env, value, opened_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(key, rule.id, s.resource_id, s.env, value, stamp, stamp)
            .run();
          changes.push({ state: 'open', key, rule, resourceId: s.resource_id, env: s.env, name: s.name, value });
        }
      } else if (open.has(key)) {
        await db.prepare('DELETE FROM ops_alerts WHERE key = ?').bind(key).run();
        changes.push({ state: 'resolved', key, rule, resourceId: s.resource_id, env: s.env, name: s.name, value });
      }
    }
  }
  // A rule that was disabled or deleted resolves its open alerts
  const ruleIds = new Set(rules.map((r) => r.id));
  for (const a of open.values()) {
    if (ruleIds.has(a.rule_id) || seen.has(a.key)) continue;
    await db.prepare('DELETE FROM ops_alerts WHERE key = ?').bind(a.key).run();
    const name = a.resource_id.slice(a.resource_id.indexOf(':') + 1);
    changes.push({ state: 'resolved', key: a.key, rule: { id: a.rule_id } as ThresholdRule, resourceId: a.resource_id, env: a.env, name, value: null });
  }
  return changes;
}

const METRIC_TITLE: Record<ThresholdRule['metric'], string> = {
  error_rate: 'error rate',
  cpu_p99: 'CPU p99',
  latency_p99: 'query latency p99',
  backlog_max: 'queue backlog',
  dlq_backlog: 'dead-lettered messages',
};

/** Admin-facing title of an alert (the Errors page groups items by title). */
export function alertTitle(rule: ThresholdRule): string {
  return `Ops: ${METRIC_TITLE[rule.metric] ?? rule.metric} over threshold`;
}

export function formatValue(rule: ThresholdRule, value: number | null): string {
  if (value === null) return 'n/a';
  if (rule.metric === 'error_rate') return `${(value * 100).toFixed(2)}%`;
  return String(Math.round(value * 100) / 100);
}
