'use server';

import type { DailyMetric, DateWindow, TrafficData } from '@/lib/studio/analytics';
import { apiRequestServer, buildApiUrl, buildQueryParams } from './api-client';
import { getServerAuthContext } from './server-auth';

const TIMEOUT_MS = 20000;

export interface StudioChannelAnalytics {
  totalViews: number;
  totalSubscribers: number;
  recentMetrics: DailyMetric[];
  traffic: TrafficData;
}

export interface StudioVideoAnalytics {
  title: string;
  views: number;
  likes: number;
  comments: number;
  watchTime: number;
  avgViewDuration: number;
  traffic: TrafficData;
}

export interface RetentionCurve {
  starts: number;
  points: Array<{ bucket: number; share: number }> | null;
}

export interface TopContentItem {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  isPublic: boolean;
  views: number;
  watchTime: number;
  avgViewDuration: number;
}

function get<T>(path: string, functionName: string): Promise<T | null> {
  return apiRequestServer<T>({ method: 'GET', url: buildApiUrl(path), functionName, timeoutMs: TIMEOUT_MS }, getServerAuthContext, true);
}

export async function getStudioChannelAnalytics(channelId: string, window: DateWindow): Promise<StudioChannelAnalytics | null> {
  return get(`/api/analytics/channels/${encodeURIComponent(channelId)}${buildQueryParams({ ...window })}`, 'getStudioChannelAnalytics');
}

export async function getStudioVideoAnalytics(videoId: string, window: DateWindow): Promise<StudioVideoAnalytics | null> {
  return get(`/api/analytics/videos/${encodeURIComponent(videoId)}${buildQueryParams({ ...window })}`, 'getStudioVideoAnalytics');
}

export async function getVideoRetention(videoId: string, window: DateWindow): Promise<RetentionCurve | null> {
  return get(`/api/analytics/videos/${encodeURIComponent(videoId)}/retention${buildQueryParams({ ...window })}`, 'getVideoRetention');
}

export async function getTopContent(channelId: string, window: DateWindow, cursor?: string): Promise<{ items: TopContentItem[]; cursor: string | null } | null> {
  const response = await get<{ result: { items: TopContentItem[]; cursor: string | null } }>(
    `/api/channels/${encodeURIComponent(channelId)}/analytics/top-content${buildQueryParams({ ...window, cursor })}`,
    'getTopContent',
  );
  return response?.result ?? null;
}
