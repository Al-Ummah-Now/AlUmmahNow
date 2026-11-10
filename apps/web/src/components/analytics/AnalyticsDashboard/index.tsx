'use client';

import React from 'react';
import { AnalyticsSummary, ChannelAnalyticsData, AnalyticsMetrics } from '@/lib/api/types';
import { useLanguage } from '@/hooks/useLanguage';
import AnalyticsCard from '../AnalyticsCard';
import MetricsChart from '../MetricsChart';
import { analyticsCsvFilename, buildAnalyticsCsv, downloadCsv } from '@/lib/analytics/csv-export';
import { logger } from '@/lib/logger-client';

export interface AnalyticsDashboardProps {
  summary: AnalyticsSummary | null;
  channelData: ChannelAnalyticsData | null;
  metrics: AnalyticsMetrics[] | null;
  /** Card implementation (the RTL dashboard passes the RTL card) */
  CardComponent?: typeof AnalyticsCard;
}

type ChangeField = 'views' | 'likes' | 'comments' | 'subscribers' | 'watchTime';

/** Sum of one field over the daily series (0 without data). */
export function seriesTotal(metrics: AnalyticsMetrics[] | null, field: ChangeField): number {
  return (metrics ?? []).reduce((n, m) => n + (Number(m[field]) || 0), 0);
}

/** Seconds as hours with one decimal (watch time cards). */
export function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/**
 * Compare the second half of the daily series with the first half (by default
 * the last 14 days vs the 14 before). Returns undefined when there's no baseline.
 */
export function periodChange(
  metrics: AnalyticsMetrics[] | null,
  field: ChangeField
): { label: string; type: 'positive' | 'negative' | 'neutral' } | undefined {
  if (!metrics || metrics.length < 2) return undefined;
  const half = Math.floor(metrics.length / 2);
  const before = metrics.slice(0, half).reduce((n, m) => n + (m[field] || 0), 0);
  const after = metrics.slice(metrics.length - half).reduce((n, m) => n + (m[field] || 0), 0);
  if (before === 0) return undefined;
  const pct = Math.round(((after - before) / before) * 1000) / 10;
  return {
    label: `${pct > 0 ? '+' : ''}${pct}%`,
    type: pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral',
  };
}

const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  summary,
  channelData,
  metrics,
  CardComponent = AnalyticsCard,
}) => {
  const { t, lang, isRTL } = useLanguage();
  const d = t.analytics.dashboard;
  const fmt = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en-US');

  if (!summary) {
    return (
      <div className="text-center py-8" dir={isRTL ? 'rtl' : 'ltr'}>
        <p className="text-gray-600 dark:text-gray-300">{d.noData}</p>
      </div>
    );
  }

  const change = (field: ChangeField) => {
    const result = periodChange(metrics, field);
    return result
      ? { change: d.changeVsPrevious.replace('{change}', result.label), changeType: result.type }
      : {};
  };

  const exportCsv = () => {
    const csv = buildAnalyticsCsv(metrics, channelData?.topPerformingVideos, {
      date: d.csvDate,
      views: t.analytics.views,
      likes: d.likes,
      comments: d.comments,
      shares: d.csvShares,
      subscribers: t.analytics.subscribers,
      watchTimeHours: d.csvWatchTimeHours,
      video: d.csvVideo,
      videoId: d.csvVideoId,
      published: d.csvPublished,
    });
    logger.debug('[AnalyticsDashboard] CSV export', { channelId: channelData?.channelId, days: metrics?.length ?? 0 });
    downloadCsv(analyticsCsvFilename(channelData?.channelId), csv);
  };

  return (
    <div className="space-y-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={exportCsv}
          title={d.exportCsvHint}
          data-testid="analytics-export-csv"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 3a1 1 0 011 1v7.59l2.3-2.3a1 1 0 111.4 1.42l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.42L9 11.6V4a1 1 0 011-1zM4 15a1 1 0 011 1v1h10v-1a1 1 0 112 0v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2a1 1 0 011-1z" />
          </svg>
          {d.exportCsv}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <CardComponent title={d.totalViews} value={fmt(summary.totalViews)} icon="eye" {...change('views')} />
        <CardComponent title={d.totalLikes} value={fmt(summary.totalLikes)} icon="heart" {...change('likes')} />
        <CardComponent title={d.totalComments} value={fmt(summary.totalComments)} icon="message" {...change('comments')} />
        <CardComponent title={t.analytics.subscribers} value={fmt(summary.totalSubscribers)} icon="users" {...change('subscribers')} />
      </div>

      {/* #241: watch time and subscriber growth over the series' period */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="analytics-growth-cards">
        <CardComponent
          title={d.watchTimeHours}
          value={d.hoursValue.replace('{hours}', toHours(seriesTotal(metrics, 'watchTime')).toLocaleString(lang === 'ar' ? 'ar' : 'en-US'))}
          subtitle={d.inLastDays.replace('{days}', fmt(metrics?.length ?? 0))}
          icon="clock"
          {...change('watchTime')}
        />
        <CardComponent
          title={d.newSubscribers}
          value={fmt(seriesTotal(metrics, 'subscribers'))}
          subtitle={d.inLastDays.replace('{days}', fmt(metrics?.length ?? 0))}
          icon="users"
          {...change('subscribers')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CardComponent title={d.totalVideos} value={fmt(summary.totalVideos)} subtitle={d.publishedContent} icon="video" />
        <CardComponent title={d.avgViewsPerVideo} value={fmt(summary.avgViewsPerVideo)} subtitle={d.performanceIndicator} icon="trending" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">{d.engagementOverview}</h3>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{summary.engagementRate.toFixed(1)}%</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">{d.overallEngagementRate}</p>
          </div>
          {summary.topVideo && (
            <div className="text-end">
              <p className="text-sm font-medium text-gray-800 dark:text-white">{d.topPerformingVideo}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300 truncate max-w-xs">{summary.topVideo.title}</p>
              <p className="text-sm text-blue-600 dark:text-blue-400">
                {d.viewsCount.replace('{count}', fmt(summary.topVideo.views))}
              </p>
            </div>
          )}
        </div>
      </div>

      {metrics && metrics.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">{d.performanceTrends}</h3>
          <MetricsChart data={metrics} />
        </div>
      )}

      {channelData?.topPerformingVideos && channelData.topPerformingVideos.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">{d.topPerformingVideos}</h3>
          <div className="space-y-4">
            {channelData.topPerformingVideos.slice(0, 5).map((video) => (
              <div key={video.videoId} className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-800 dark:text-white truncate">{video.title}</h4>
                  {video.dateCreated && (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {new Date(video.dateCreated).toLocaleDateString(lang === 'ar' ? 'ar' : 'en-US')}
                    </p>
                  )}
                </div>
                <div className="text-end">
                  <p className="font-semibold text-gray-800 dark:text-white">
                    {d.viewsCount.replace('{count}', fmt(video.views))}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {d.likesAndComments.replace('{likes}', fmt(video.likes)).replace('{comments}', fmt(video.comments))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
