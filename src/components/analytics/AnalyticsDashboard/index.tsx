import React from 'react';
import { AnalyticsSummary, ChannelAnalyticsData, AnalyticsMetrics } from '@/lib/api/types';
import AnalyticsCard from '../AnalyticsCard';
import MetricsChart from '../MetricsChart';

interface AnalyticsDashboardProps {
  summary: AnalyticsSummary | null;
  channelData: ChannelAnalyticsData | null;
  metrics: AnalyticsMetrics[] | null;
}

const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  summary,
  channelData,
  metrics
}) => {
  if (!summary) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-600 dark:text-gray-300">No analytics data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <AnalyticsCard
          title="Total Views"
          value={summary.totalViews.toLocaleString()}
          change="+12.5%"
          changeType="positive"
          icon="eye"
        />
        <AnalyticsCard
          title="Total Likes"
          value={summary.totalLikes.toLocaleString()}
          change="+8.3%"
          changeType="positive"
          icon="heart"
        />
        <AnalyticsCard
          title="Total Comments"
          value={summary.totalComments.toLocaleString()}
          change="+15.2%"
          changeType="positive"
          icon="message"
        />
        <AnalyticsCard
          title="Subscribers"
          value={summary.totalSubscribers.toLocaleString()}
          change="+5.1%"
          changeType="positive"
          icon="users"
        />
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnalyticsCard
          title="Total Videos"
          value={summary.totalVideos.toString()}
          subtitle="Published content"
          icon="video"
        />
        <AnalyticsCard
          title="Avg Views per Video"
          value={summary.avgViewsPerVideo.toLocaleString()}
          subtitle="Performance indicator"
          icon="trending"
        />
      </div>

      {/* Engagement Rate Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
          Engagement Overview
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {summary.engagementRate.toFixed(1)}%
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">Overall Engagement Rate</p>
          </div>
          {summary.topVideo && (
            <div className="text-right">
              <p className="text-sm font-medium text-gray-800 dark:text-white">
                Top Performing Video:
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 truncate max-w-xs">
                {summary.topVideo.title}
              </p>
              <p className="text-sm text-blue-600 dark:text-blue-400">
                {summary.topVideo.views.toLocaleString()} views
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Chart */}
      {metrics && metrics.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
            Performance Trends
          </h3>
          <MetricsChart data={metrics} />
        </div>
      )}

      {/* Top Performing Videos */}
      {channelData?.topPerformingVideos && channelData.topPerformingVideos.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
            Top Performing Videos
          </h3>
          <div className="space-y-4">
            {channelData.topPerformingVideos.slice(0, 5).map((video, index) => (
              <div key={video.videoId} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex-1">
                  <h4 className="font-medium text-gray-800 dark:text-white">
                    {video.title}
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {new Date(video.dateCreated).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-800 dark:text-white">
                    {video.views.toLocaleString()} views
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {video.likes} likes • {video.comments} comments
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