import React from 'react';
import { AnalyticsMetrics } from '@/lib/api/types';

interface MetricsChartProps {
  data: AnalyticsMetrics[];
}

const MetricsChart: React.FC<MetricsChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500 dark:text-gray-400">
        No metrics data available
      </div>
    );
  }

  // Find max values for scaling
  const maxViews = Math.max(...data.map(d => d.views));
  const maxLikes = Math.max(...data.map(d => d.likes));
  const maxComments = Math.max(...data.map(d => d.comments));

  return (
    <div className="space-y-6">
      {/* Views Chart */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Views Over Time
        </h4>
        <div className="h-24 flex items-end space-x-2">
          {data.map((metric, index) => (
            <div key={index} className="flex flex-col items-center flex-1">
              <div
                className="bg-blue-500 dark:bg-blue-400 rounded-t w-full min-h-[2px] transition-all duration-300 hover:bg-blue-600 dark:hover:bg-blue-300"
                style={{
                  height: `${(metric.views / maxViews) * 100}%`,
                }}
                title={`${metric.views} views on ${new Date(metric.date).toLocaleDateString()}`}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 transform -rotate-45 origin-center">
                {new Date(metric.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Engagement Chart */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Engagement Metrics
        </h4>
        <div className="h-24 flex items-end space-x-2">
          {data.map((metric, index) => (
            <div key={index} className="flex flex-col items-center flex-1 space-y-1">
              {/* Likes */}
              <div
                className="bg-green-500 dark:bg-green-400 rounded w-full min-h-[2px]"
                style={{
                  height: `${(metric.likes / maxLikes) * 40}%`,
                }}
                title={`${metric.likes} likes`}
              />
              {/* Comments */}
              <div
                className="bg-yellow-500 dark:bg-yellow-400 rounded w-full min-h-[2px]"
                style={{
                  height: `${(metric.comments / maxComments) * 40}%`,
                }}
                title={`${metric.comments} comments`}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 transform -rotate-45 origin-center">
                {new Date(metric.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center space-x-4 mt-3">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-500 rounded"></div>
            <span className="text-xs text-gray-600 dark:text-gray-300">Likes</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-yellow-500 rounded"></div>
            <span className="text-xs text-gray-600 dark:text-gray-300">Comments</span>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">Total Views</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {data.reduce((sum, d) => sum + d.views, 0).toLocaleString()}
          </p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">Total Likes</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {data.reduce((sum, d) => sum + d.likes, 0).toLocaleString()}
          </p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">Total Comments</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {data.reduce((sum, d) => sum + d.comments, 0).toLocaleString()}
          </p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">Avg Daily Views</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {Math.round(data.reduce((sum, d) => sum + d.views, 0) / data.length).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default MetricsChart;