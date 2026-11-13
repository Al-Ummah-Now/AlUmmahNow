/**
 * Site visits panel model (owner decision D-SEO-9, wiki AUN-SEO): the period
 * choice, the daily series for the chart, sources grouped by kind (search
 * engines, social networks, our own platform, other websites, direct), shares
 * of the period total and number formats with the locale's digits. The report
 * is admin-api GET /api/content/analytics/visits?days=N (api-videos
 * siteVisitsReport): cookieless daily counters, aggregates only. Pure: server
 * and client safe.
 */
import { chartLocale, compactNumber } from '@al-ummah/shared-types';
import type { Translator } from '@/i18n/translate';

/** admin-api /api/content/analytics/visits (api-videos lib/site-visits.ts). */
export interface SiteVisitsReport {
  days: number;
  /** First and last day of the period (UTC, YYYY-MM-DD), today included */
  from: string;
  to: string;
  /** Visits in the period (the sum of `daily`), not since launch */
  visits: number;
  daily: { day: string; visits: number }[];
  landing: { kind: string; visits: number }[];
  sources: { source: string; visits: number }[];
  referrers: { host: string; visits: number }[];
}

export const VISIT_PERIODS = [7, 30, 90] as const;
export type VisitPeriod = (typeof VISIT_PERIODS)[number];

export function parseVisitPeriod(value: unknown): VisitPeriod {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (VISIT_PERIODS as readonly number[]).includes(n) ? (n as VisitPeriod) : 30;
}

const DAY_MS = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * One point per day of the period, oldest first. Days the report leaves out
 * count 0: a counter with no row had no visits (the report omits the series
 * when the counters database is not bound).
 */
export function dailyPoints(report: Pick<SiteVisitsReport, 'from' | 'to' | 'daily'>): { t: string; value: number }[] {
  const byDay = new Map(report.daily.map((d) => [d.day, d.visits]));
  const start = dayMs(report.from);
  const end = dayMs(report.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return report.daily.map((d) => ({ t: d.day, value: d.visits }));
  const out: { t: string; value: number }[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const t = new Date(ms).toISOString().slice(0, 10);
    out.push({ t, value: byDay.get(t) ?? 0 });
  }
  return out;
}

export const SOURCE_GROUPS = ['search', 'social', 'platform', 'site', 'direct'] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export interface SourceGroupRow {
  group: SourceGroup;
  visits: number;
  /** Engines or networks inside the group (search and social), largest first */
  items: { name: string; visits: number }[];
}

/** The group of a source value: search:<engine>, social:<network>, platform, site, direct (anything else: site). */
export function sourceGroupOf(source: string): { group: SourceGroup; name: string | null } {
  const [kind, name] = source.split(':', 2);
  if ((kind === 'search' || kind === 'social') && name) return { group: kind, name };
  if (kind === 'platform' || kind === 'direct' || kind === 'site') return { group: kind, name: null };
  return { group: 'site', name: null };
}

/** Sources summed by group, largest group first; groups without visits are left out. */
export function groupSources(sources: SiteVisitsReport['sources']): SourceGroupRow[] {
  const rows = new Map<SourceGroup, SourceGroupRow>();
  for (const s of sources) {
    const visits = Number(s.visits) || 0;
    if (visits <= 0) continue;
    const { group, name } = sourceGroupOf(s.source);
    const row = rows.get(group) ?? { group, visits: 0, items: [] };
    row.visits += visits;
    if (name) {
      const item = row.items.find((i) => i.name === name);
      if (item) item.visits += visits;
      else row.items.push({ name, visits });
    }
    rows.set(group, row);
  }
  const order = (g: SourceGroup) => SOURCE_GROUPS.indexOf(g);
  return [...rows.values()]
    .map((r) => ({ ...r, items: r.items.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.visits - a.visits || order(a.group) - order(b.group));
}

/** Display names of search engines and social networks (brand names stay as they are; 'ai' is translated). */
const SOURCE_NAMES: Record<string, string> = {
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
  yahoo: 'Yahoo',
  yandex: 'Yandex',
  baidu: 'Baidu',
  ecosia: 'Ecosia',
  brave: 'Brave',
  naver: 'Naver',
  seznam: 'Seznam',
  qwant: 'Qwant',
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  snapchat: 'Snapchat',
  threads: 'Threads',
};

/** A brand's display name, or null for 'ai' (the caller translates it). */
export function sourceName(name: string): string | null {
  if (name === 'ai') return null;
  return SOURCE_NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** Share of the period's visits, 0..1 (0 without visits). */
export function shareOf(visits: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, visits / total)) : 0;
}

export interface VisitFormats {
  /** Exact count with the locale's digits (tiles, tables) */
  count: (v: number) => string;
  /** Compact count for the chart axis */
  axis: (v: number) => string;
  percent: (share: number) => string;
  /** A day as "13 Nov" (UTC) */
  day: (day: string) => string;
  /** A day as "13 Nov 2026" (UTC) */
  date: (day: string) => string;
}

export function visitFormats(locale: string): VisitFormats {
  const loc = chartLocale(locale);
  const count = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const date = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: 'UTC' });
  const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
  return {
    count: (v) => count.format(v),
    axis: compactNumber(locale),
    percent: (s) => percent.format(s),
    day: (d) => day.format(asDate(d)),
    date: (d) => date.format(asDate(d)),
  };
}

/** "Last 30 days": the fixed periods have their own wording (Arabic number agreement), others the generic one. */
export function visitPeriodLabel(t: Translator, days: number): string {
  if (days === 7) return t('siteVisits.periods.d7');
  if (days === 30) return t('siteVisits.periods.d30');
  if (days === 90) return t('siteVisits.periods.d90');
  return t('siteVisits.periods.other', { days });
}
