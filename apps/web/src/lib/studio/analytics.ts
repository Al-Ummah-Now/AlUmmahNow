/** Date ranges and sums for the Studio Analytics page (spec §4.6). */

import { dateTimeFormat } from '@al-ummah/shared-types';
import { localizedText } from '@/lib/playlists/playlist-names';

export type RangePreset = '7' | '28' | '90' | '365' | 'all';

export const RANGE_PRESETS: readonly RangePreset[] = ['7', '28', '90', '365', 'all'];

export interface DateWindow {
  dateFrom: string;
  dateTo: string;
  /** The viewer's IANA zone: the API puts likes, comments and subscribers on their local day */
  tz: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The browser's IANA time zone, UTC when it can't tell. */
export function viewerTimeZone(): string {
  try {
    return dateTimeFormat('en').resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** YYYY-MM-DD of `time` on the calendar of `timeZone`. */
export function localDay(time: number, timeZone: string): string {
  try {
    const p: Record<string, string> = {};
    for (const part of dateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time))) p[part.type] = part.value;
    return `${p.year}-${p.month}-${p.day}`;
  } catch {
    return new Date(time).toISOString().slice(0, 10);
  }
}

/** `day` moved by whole calendar days (date arithmetic at UTC midnight, so DST never shifts it). */
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The range's calendar days in the viewer's time zone, the way admin times are shown: "today" is
 * the viewer's today, so at 7:30 pm in New York the chart still ends on that date while UTC is
 * already on the next one.
 */
export function rangeDates(preset: RangePreset, now: Date, channelCreated?: string, timeZone: string = viewerTimeZone()): { current: DateWindow; previous: DateWindow | null } {
  const today = localDay(now.getTime(), timeZone);
  if (preset === 'all') {
    const created = channelCreated ? Date.parse(channelCreated) : NaN;
    const from = Number.isFinite(created) ? localDay(created, timeZone) : addDays(today, -364);
    return { current: { dateFrom: from, dateTo: today, tz: timeZone }, previous: null };
  }
  const days = Number(preset);
  const start = addDays(today, -(days - 1));
  return {
    current: { dateFrom: start, dateTo: today, tz: timeZone },
    previous: { dateFrom: addDays(start, -days), dateTo: addDays(start, -1), tz: timeZone },
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
