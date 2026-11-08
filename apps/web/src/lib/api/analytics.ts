'use server';

import {
  ApiHeaders,
  AnalyticsQueryParams,
  VideoAnalyticsData,
  ChannelAnalyticsData,
  AnalyticsSummary,
  AnalyticsMetrics
} from "./types";
import { apiRequestServer, buildApiUrl, buildQueryParams } from "./api-client";
import { getServerAuthContext } from "./server-auth";

/**
 * Analytics are owner-scoped: every call sends the session token and returns
 * null when the user is signed out, lacks access, or the API is unavailable.
 * Callers render an empty state in that case - there is no sample data.
 */
/**
 * Analytics requests are aborted after this long so the dashboard can show an
 * error instead of waiting on a stalled request.
 */
const ANALYTICS_TIMEOUT_MS = 20000;

async function authFor(headers?: ApiHeaders) {
  const auth = await getServerAuthContext();
  if (!auth?.accessToken) return null;
  return { ...auth, channelId: headers?.channelId || auth.channelId || '' };
}

/**
 * Get analytics summary (all of the user's channels, or one via params.channelId)
 * GET /api/analytics/summary
 */
export async function getSummary(
  params?: AnalyticsQueryParams,
  headers?: ApiHeaders
): Promise<AnalyticsSummary | null> {
  const query = buildQueryParams({ channelId: params?.channelId, dateFrom: params?.dateFrom, dateTo: params?.dateTo });
  return apiRequestServer<AnalyticsSummary>({
    method: 'GET',
    url: buildApiUrl(`/api/analytics/summary${query}`),
    functionName: 'getAnalyticsSummary',
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  }, () => authFor(headers), true);
}

/**
 * Get channel analytics data (owner only)
 * GET /api/analytics/channels/{channelId}
 */
export async function getChannelAnalytics(
  channelId: string,
  params?: AnalyticsQueryParams,
  headers?: ApiHeaders
): Promise<ChannelAnalyticsData | null> {
  const query = buildQueryParams({ dateFrom: params?.dateFrom, dateTo: params?.dateTo });
  return apiRequestServer<ChannelAnalyticsData>({
    method: 'GET',
    url: buildApiUrl(`/api/analytics/channels/${encodeURIComponent(channelId)}${query}`),
    functionName: 'getChannelAnalytics',
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  }, () => authFor(headers), true);
}

/**
 * Get video analytics data (owner only)
 * GET /api/analytics/videos/{videoId}
 */
export async function getVideoAnalytics(
  videoId: string,
  params?: AnalyticsQueryParams,
  headers?: ApiHeaders
): Promise<VideoAnalyticsData | null> {
  const query = buildQueryParams({ dateFrom: params?.dateFrom, dateTo: params?.dateTo });
  return apiRequestServer<VideoAnalyticsData>({
    method: 'GET',
    url: buildApiUrl(`/api/analytics/videos/${encodeURIComponent(videoId)}${query}`),
    functionName: 'getVideoAnalytics',
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  }, () => authFor(headers), true);
}

/**
 * Get daily analytics metrics (oldest first)
 * GET /api/analytics/metrics
 */
export async function getMetrics(
  params?: AnalyticsQueryParams,
  headers?: ApiHeaders
): Promise<AnalyticsMetrics[] | null> {
  const query = buildQueryParams({
    channelId: params?.channelId,
    dateFrom: params?.dateFrom,
    dateTo: params?.dateTo,
    limit: params?.limit,
  });
  return apiRequestServer<AnalyticsMetrics[]>({
    method: 'GET',
    url: buildApiUrl(`/api/analytics/metrics${query}`),
    functionName: 'getAnalyticsMetrics',
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  }, () => authFor(headers), true);
}

export interface AnalyticsDashboardData {
  summary: AnalyticsSummary | null;
  metrics: AnalyticsMetrics[] | null;
  channel: ChannelAnalyticsData | null;
}

/**
 * Everything the analytics page shows, in one server action: totals and the
 * daily series for all of the user's channels, plus the selected channel's
 * analytics. The three API calls run in parallel here, because server actions
 * called from the browser run one at a time.
 */
export async function getAnalyticsDashboard(channelId?: string | null): Promise<AnalyticsDashboardData> {
  const [summary, metrics, channel] = await Promise.all([
    getSummary(),
    getMetrics(),
    channelId ? getChannelAnalytics(channelId) : Promise.resolve(null),
  ]);
  return { summary, metrics, channel };
}
