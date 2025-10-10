import React from 'react';
import { AnalyticsSummary, ChannelAnalyticsData, AnalyticsMetrics } from '@/lib/api/types';
import AnalyticsCardRTL from '../../AnalyticsCard/rtl';
import MetricsChart from '../../MetricsChart';

interface AnalyticsDashboardProps {
  summary: AnalyticsSummary | null;
  channelData: ChannelAnalyticsData | null;
  metrics: AnalyticsMetrics[] | null;
}

const AnalyticsDashboardRTL: React.FC<AnalyticsDashboardProps> = ({
  summary,
  channelData,
  metrics
}) => {
  if (!summary) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-600 dark:text-gray-300">لا توجد بيانات تحليلات متاحة</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <AnalyticsCardRTL
          title="إجمالي المشاهدات"
          value={summary.totalViews.toLocaleString()}
          change="+12.5%"
          changeType="positive"
          icon="eye"
        />
        <AnalyticsCardRTL
          title="إجمالي الإعجابات"
          value={summary.totalLikes.toLocaleString()}
          change="+8.3%"
          changeType="positive"
          icon="heart"
        />
        <AnalyticsCardRTL
          title="إجمالي التعليقات"
          value={summary.totalComments.toLocaleString()}
          change="+15.2%"
          changeType="positive"
          icon="message"
        />
        <AnalyticsCardRTL
          title="المشتركون"
          value={summary.totalSubscribers.toLocaleString()}
          change="+5.1%"
          changeType="positive"
          icon="users"
        />
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnalyticsCardRTL
          title="إجمالي الفيديوهات"
          value={summary.totalVideos.toString()}
          subtitle="المحتوى المنشور"
          icon="video"
        />
        <AnalyticsCardRTL
          title="متوسط المشاهدات لكل فيديو"
          value={summary.avgViewsPerVideo.toLocaleString()}
          subtitle="مؤشر الأداء"
          icon="trending"
        />
      </div>

      {/* Engagement Rate Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
          نظرة عامة على التفاعل
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {summary.engagementRate.toFixed(1)}%
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">معدل التفاعل الإجمالي</p>
          </div>
          {summary.topVideo && (
            <div className="text-left">
              <p className="text-sm font-medium text-gray-800 dark:text-white">
                أفضل فيديو أداءً:
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 truncate max-w-xs">
                {summary.topVideo.title}
              </p>
              <p className="text-sm text-blue-600 dark:text-blue-400">
                {summary.topVideo.views.toLocaleString()} مشاهدة
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Chart */}
      {metrics && metrics.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
            اتجاهات الأداء
          </h3>
          <MetricsChart data={metrics} />
        </div>
      )}

      {/* Top Performing Videos */}
      {channelData?.topPerformingVideos && channelData.topPerformingVideos.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
            أفضل الفيديوهات أداءً
          </h3>
          <div className="space-y-4">
            {channelData.topPerformingVideos.slice(0, 5).map((video) => (
              <div key={video.videoId} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex-1">
                  <h4 className="font-medium text-gray-800 dark:text-white">
                    {video.title}
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {new Date(video.dateCreated).toLocaleDateString('ar-SA')}
                  </p>
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-800 dark:text-white">
                    {video.views.toLocaleString()} مشاهدة
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {video.likes} إعجاب • {video.comments} تعليق
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

export default AnalyticsDashboardRTL;