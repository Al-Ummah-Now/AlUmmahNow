'use client';

import React from 'react';
import { AnalyticsMetrics } from '@/lib/api/types';
import { useLanguage } from '@/hooks/useLanguage';

interface MetricsChartProps {
  data: AnalyticsMetrics[];
}

/** Bar height as a percentage of the series maximum (0 when the series is all zeros). */
function scale(value: number, max: number, full: number): string {
  return `${max > 0 ? (value / max) * full : 0}%`;
}

const MetricsChart: React.FC<MetricsChartProps> = ({ data }) => {
  const { t, lang, isRTL } = useLanguage();
  const d = t.analytics.dashboard;
  const locale = lang === 'ar' ? 'ar' : 'en-US';
  const fmt = (n: number) => n.toLocaleString(locale);
  const dayLabel = (date: string) => new Date(date).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const totalViews = data?.reduce((sum, m) => sum + m.views, 0) ?? 0;
  const totalLikes = data?.reduce((sum, m) => sum + m.likes, 0) ?? 0;
  const totalComments = data?.reduce((sum, m) => sum + m.comments, 0) ?? 0;
  const totalWatchTime = data?.reduce((sum, m) => sum + (m.watchTime || 0), 0) ?? 0;
  const totalSubscribers = data?.reduce((sum, m) => sum + (m.subscribers || 0), 0) ?? 0;

  if (!data || data.length === 0 || totalViews + totalLikes + totalComments + totalWatchTime + totalSubscribers === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-gray-500 dark:text-gray-400">
        {d.noMetrics}
      </div>
    );
  }

  const maxViews = Math.max(...data.map(m => m.views));
  const maxLikes = Math.max(...data.map(m => m.likes));
  const maxComments = Math.max(...data.map(m => m.comments));
  const maxWatchTime = Math.max(...data.map(m => m.watchTime || 0));
  const maxSubscribers = Math.max(...data.map(m => m.subscribers || 0));
  const minutes = (seconds: number) => Math.round((seconds || 0) / 60);
  // Label every Nth day so long ranges stay readable
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));

  return (
    <div className="space-y-6 overflow-x-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{d.viewsOverTime}</h4>
        <div className="h-24 flex items-end gap-1">
          {data.map((metric, index) => (
            <div key={metric.date} className="flex flex-col items-center flex-1 min-w-0 h-full justify-end">
              <div
                className="bg-blue-500 dark:bg-blue-400 rounded-t w-full min-h-[2px] transition-all duration-300 hover:bg-blue-600 dark:hover:bg-blue-300"
                style={{ height: scale(metric.views, maxViews, 100) }}
                title={`${dayLabel(metric.date)}: ${d.viewsCount.replace('{count}', fmt(metric.views))}`}
              />
              {index % labelEvery === 0 && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 whitespace-nowrap">{dayLabel(metric.date)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{d.engagementMetrics}</h4>
        <div className="h-24 flex items-end gap-1">
          {data.map((metric) => (
            <div key={metric.date} className="flex flex-col items-center justify-end flex-1 min-w-0 h-full gap-1">
              <div
                className="bg-green-500 dark:bg-green-400 rounded w-full min-h-[2px]"
                style={{ height: scale(metric.likes, maxLikes, 45) }}
                title={`${dayLabel(metric.date)}: ${d.likes} ${fmt(metric.likes)}`}
              />
              <div
                className="bg-brand dark:bg-brand rounded w-full min-h-[2px]"
                style={{ height: scale(metric.comments, maxComments, 45) }}
                title={`${dayLabel(metric.date)}: ${d.comments} ${fmt(metric.comments)}`}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-4 mt-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded"></div>
            <span className="text-xs text-gray-600 dark:text-gray-300">{d.likes}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-brand rounded"></div>
            <span className="text-xs text-gray-600 dark:text-gray-300">{d.comments}</span>
          </div>
        </div>
      </div>

      {/* #241: watch time (minutes per day) and new subscribers per day */}
      <div data-testid="metrics-watch-time">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{d.watchTimeOverTime}</h4>
        <div className="h-24 flex items-end gap-1">
          {data.map((metric) => (
            <div key={metric.date} className="flex flex-col items-center flex-1 min-w-0 h-full justify-end">
              <div
                className="bg-purple-500 dark:bg-purple-400 rounded-t w-full min-h-[2px]"
                style={{ height: scale(metric.watchTime || 0, maxWatchTime, 100) }}
                title={`${dayLabel(metric.date)}: ${d.minutesCount.replace('{count}', fmt(minutes(metric.watchTime)))}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div data-testid="metrics-subscribers">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{d.subscribersOverTime}</h4>
        <div className="h-24 flex items-end gap-1">
          {data.map((metric) => (
            <div key={metric.date} className="flex flex-col items-center flex-1 min-w-0 h-full justify-end">
              <div
                className="bg-red-500 dark:bg-red-400 rounded-t w-full min-h-[2px]"
                style={{ height: scale(metric.subscribers || 0, maxSubscribers, 100) }}
                title={`${dayLabel(metric.date)}: ${d.subscribersCount.replace('{count}', fmt(metric.subscribers || 0))}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">{d.totalViews}</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{fmt(totalViews)}</p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">{d.totalLikes}</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{fmt(totalLikes)}</p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">{d.totalComments}</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{fmt(totalComments)}</p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">{d.avgDailyViews}</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{fmt(Math.round(totalViews / data.length))}</p>
        </div>
      </div>
    </div>
  );
};

export default MetricsChart;
