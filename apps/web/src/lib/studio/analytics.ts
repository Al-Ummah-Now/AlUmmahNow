/** Date ranges and sums for the Studio Analytics page (spec §4.6). */

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
}

/** Sources by views, with "Not shared" last so the known sources read as a ranking. */
export function trafficRows(traffic: TrafficData): Array<{ source: string; views: number; share: number }> {
  if (!traffic.totalViews) return [];
  return Object.entries(traffic.sources)
    .map(([source, views]) => ({ source, views, share: Math.round((views / traffic.totalViews) * 1000) / 1000 }))
    .sort((a, b) => Number(a.source === 'unknown') - Number(b.source === 'unknown') || b.views - a.views);
}
