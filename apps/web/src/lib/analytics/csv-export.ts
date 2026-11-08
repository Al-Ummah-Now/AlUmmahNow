/**
 * Creator analytics CSV export (Epic 5.1). Built in the browser from the data
 * the dashboard already loaded, so no extra API.
 *
 * Video titles are user content: a cell starting with = + - @ (or tab/CR) is
 * prefixed with an apostrophe so spreadsheets don't run it as a formula
 * (CSV injection). Downloads carry a UTF-8 BOM so Excel shows Arabic correctly.
 */
import type { AnalyticsMetrics, VideoAnalyticsData } from '@al-ummah/shared-types';

export interface AnalyticsCsvLabels {
  date: string;
  views: string;
  likes: string;
  comments: string;
  shares: string;
  subscribers: string;
  watchTimeHours: string;
  video: string;
  videoId: string;
  published: string;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: neutralises formulas, quotes when needed (RFC 4180). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
  if (typeof value !== 'number' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const row = (cells: unknown[]) => cells.map(csvCell).join(',');
const hours = (seconds: number) => Math.round(((Number(seconds) || 0) / 3600) * 100) / 100;

/**
 * Daily series, then a blank line, then the top videos. Lines end with CRLF
 * (what spreadsheet apps expect).
 */
export function buildAnalyticsCsv(
  metrics: AnalyticsMetrics[] | null | undefined,
  topVideos: VideoAnalyticsData[] | null | undefined,
  labels: AnalyticsCsvLabels,
): string {
  const lines: string[] = [
    row([labels.date, labels.views, labels.watchTimeHours, labels.likes, labels.comments, labels.shares, labels.subscribers]),
    ...(metrics ?? []).map((m) =>
      row([m.date, m.views || 0, hours(m.watchTime), m.likes || 0, m.comments || 0, m.shares || 0, m.subscribers || 0])),
  ];
  if (topVideos && topVideos.length > 0) {
    lines.push('');
    lines.push(row([labels.video, labels.videoId, labels.published, labels.views, labels.likes, labels.comments]));
    for (const v of topVideos) {
      lines.push(row([v.title, v.videoId, v.dateCreated ? String(v.dateCreated).slice(0, 10) : '', v.views || 0, v.likes || 0, v.comments || 0]));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/** `analytics-<channel>-<YYYY-MM-DD>.csv`, safe for file systems. */
export function analyticsCsvFilename(channelId: string | null | undefined, today: Date = new Date()): string {
  const id = (channelId || 'channel').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'channel';
  return `analytics-${id}-${today.toISOString().slice(0, 10)}.csv`;
}

/** Saves the CSV through a temporary object URL (browser only). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
