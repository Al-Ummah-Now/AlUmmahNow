/** Date ranges and sums for the Studio Analytics page (spec §4.6). */

import { localizedText } from '@/lib/playlists/playlist-names';

export type RangePreset = '7' | '28' | '90' | '365' | 'all';

export const RANGE_PRESETS: readonly RangePreset[] = ['7', '28', '90', '365', 'all'];

export interface DateWindow {
  dateFrom: string;
  dateTo: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (time: number) => new Date(time).toISOString().slice(0, 10);

export function rangeDates(preset: RangePreset, now: Date, channelCreated?: string): { current: DateWindow; previous: DateWindow | null } {
  const end = now.getTime();
  if (preset === 'all') {
    const created = channelCreated ? Date.parse(channelCreated) : NaN;
    return { current: { dateFrom: day(Number.isFinite(created) ? created : end - 364 * DAY_MS), dateTo: day(end) }, previous: null };
  }
  const days = Number(preset);
  const start = end - (days - 1) * DAY_MS;
  return {
    current: { dateFrom: day(start), dateTo: day(end) },
    previous: { dateFrom: day(start - days * DAY_MS), dateTo: day(start - DAY_MS) },
  };
}

export interface DailyMetric {
  date: string;
  views: number;
  likes: number;
  comments: number;
  subscribers: number;
  watchTime: number;
}

export interface MetricTotals {
  views: number;
  watchTime: number;
  avgViewDuration: number;
  likes: number;
  comments: number;
  subscribers: number;
}

export function sumMetrics(days: readonly DailyMetric[]): MetricTotals {
  const totals = { views: 0, watchTime: 0, avgViewDuration: 0, likes: 0, comments: 0, subscribers: 0 };
  for (const entry of days) {
    totals.views += entry.views || 0;
    totals.watchTime += entry.watchTime || 0;
    totals.likes += entry.likes || 0;
    totals.comments += entry.comments || 0;
    totals.subscribers += entry.subscribers || 0;
  }
  totals.avgViewDuration = totals.views ? Math.round(totals.watchTime / totals.views) : 0;
  return totals;
}

export function changePercent(current: number, previous: number | undefined): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface TrafficData {
  totalViews: number;
  sources: Record<string, number>;
  externalHosts: Array<{ host: string; views: number }>;
  /** Views per client surface, device class, country (top 50 + "other") and utm_source; older APIs omit them */
  surfaces?: Record<string, number>;
  devices?: Record<string, number>;
  countries?: Record<string, number>;
  campaigns?: Record<string, number>;
}

/** The overflow bucket of a capped breakdown (processor OTHER_ORIGIN). */
export const OTHER_ORIGIN = 'other';

/**
 * One origin breakdown as rows by views, its overflow ("other") last; with `limit`, rows past it
 * fold into that last row too (countries show the top 10).
 */
export function originRows(counts: Record<string, number> | undefined, totalViews: number, limit?: number): Array<{ key: string; views: number; share: number }> {
  if (!counts || !totalViews) return [];
  const named = Object.entries(counts)
    .filter(([key, views]) => key !== OTHER_ORIGIN && views > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = limit === undefined ? named : named.slice(0, limit);
  const rest = (limit === undefined ? 0 : named.slice(limit).reduce((n, [, v]) => n + v, 0)) + (counts[OTHER_ORIGIN] ?? 0);
  const rows = rest > 0 ? [...kept, [OTHER_ORIGIN, rest] as [string, number]] : kept;
  return rows.map(([key, views]) => ({ key, views, share: Math.round((views / totalViews) * 1000) / 1000 }));
}

/** Sources by views, with "Not shared" last so the known sources read as a ranking. */
export function trafficRows(traffic: TrafficData): Array<{ source: string; views: number; share: number }> {
  if (!traffic.totalViews) return [];
  return Object.entries(traffic.sources)
    .map(([source, views]) => ({ source, views, share: Math.round((views / traffic.totalViews) * 1000) / 1000 }))
    .sort((a, b) => Number(a.source === 'unknown') - Number(b.source === 'unknown') || b.views - a.views);
}

/**
 * A Top content row's title in the UI language: the video's own translation, else its stored title
 * (its half of an "EN | AR" title), the same as the Content page (AUDIT r6: Arabic showed English)
 */
export function topContentTitle(item: { title: string; titleLocalized?: Record<string, string> | null }, lang: string): string {
  return localizedText(item.title, item.titleLocalized, lang) || item.title;
}
