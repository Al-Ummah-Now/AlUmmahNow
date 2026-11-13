/**
 * The site visit counters (D-SEO-9): visits, landing pages, sources and referrer hosts of the videos
 * site over the last N days, from the processor's analytics_daily (entity 'site', id 'videos').
 */
export interface SiteVisitsReport {
  days: number;
  from: string;
  to: string;
  visits: number;
  /** Per day, oldest first (days without visits included as 0) */
  daily: { day: string; visits: number }[];
  landing: { kind: string; visits: number }[];
  sources: { source: string; visits: number }[];
  referrers: { host: string; visits: number }[];
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function siteVisitsReport(db: D1Database | undefined, days: number, now = Date.now()): Promise<SiteVisitsReport> {
  const span = Math.min(Math.max(Math.round(days) || 30, 1), 365);
  const to = isoDay(now);
  const from = isoDay(now - (span - 1) * DAY_MS);
  const empty: SiteVisitsReport = { days: span, from, to, visits: 0, daily: [], landing: [], sources: [], referrers: [] };
  if (!db) return empty;
  const { results } = await db
    .prepare(
      `SELECT day, metric, dim, SUM(value) AS total FROM analytics_daily
       WHERE entity_type = 'site' AND entity_id = 'videos' AND day BETWEEN ?1 AND ?2
       GROUP BY day, metric, dim`,
    )
    .bind(from, to)
    .all<{ day: string; metric: string; dim: string; total: number }>();
  const perDay = new Map<string, number>();
  const sums = { landing: new Map<string, number>(), source: new Map<string, number>(), referrer_host: new Map<string, number>() };
  for (const r of results ?? []) {
    const n = Number(r.total) || 0;
    if (r.metric === 'visits') perDay.set(r.day, (perDay.get(r.day) ?? 0) + n);
    else if (r.metric in sums) {
      const m = sums[r.metric as keyof typeof sums];
      m.set(r.dim, (m.get(r.dim) ?? 0) + n);
    }
  }
  const top = (m: Map<string, number>, limit: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const daily: SiteVisitsReport['daily'] = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const day = isoDay(now - i * DAY_MS);
    daily.push({ day, visits: perDay.get(day) ?? 0 });
  }
  return {
    days: span,
    from,
    to,
    visits: daily.reduce((s, d) => s + d.visits, 0),
    daily,
    landing: top(sums.landing, 20).map(([kind, visits]) => ({ kind, visits })),
    sources: top(sums.source, 30).map(([source, visits]) => ({ source, visits })),
    referrers: top(sums.referrer_host, 30).map(([host, visits]) => ({ host, visits })),
  };
}
