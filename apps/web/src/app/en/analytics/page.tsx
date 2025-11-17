"use client";
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';
import * as AnalyticsAPI from '@/lib/api/analytics';
import { AnalyticsSummary, ChannelAnalyticsData, AnalyticsMetrics } from '@/lib/api/types';
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard';

const AnalyticsPage = () => {
  const auth = useAuth();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [channelData, setChannelData] = useState<ChannelAnalyticsData | null>(null);
  const [metrics, setMetrics] = useState<AnalyticsMetrics[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAnalyticsData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load analytics data
        const [summaryData, metricsData] = await Promise.all([
          AnalyticsAPI.getSummary(),
          AnalyticsAPI.getMetrics()
        ]);

        setSummary(summaryData);
        setMetrics(metricsData);

        // Load channel data if we have user info
        if (auth?.user?.id) {
          const channelAnalytics = await AnalyticsAPI.getChannelAnalytics(auth.user.id);
          setChannelData(channelAnalytics);
        } else {
          // Load mock channel data for demonstration
          const mockChannelData = await AnalyticsAPI.getChannelAnalytics('demo-channel');
          setChannelData(mockChannelData);
        }

      } catch (err) {
        setError('Failed to load analytics data');
        console.error('Analytics loading error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadAnalyticsData();
  }, [auth?.user]);

  if (!auth?.user) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
              Analytics Dashboard (Demo Mode)
            </h1>
            <p className="text-gray-600 dark:text-gray-300">
              This is a demonstration of the analytics dashboard. Please log in to view your actual analytics.
            </p>
          </div>

          <AnalyticsDashboard 
            summary={summary}
            channelData={channelData}
            metrics={metrics}
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
            Error
          </h2>
          <p className="text-gray-600 dark:text-gray-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
            Analytics Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            Track your video performance and audience engagement
          </p>
        </div>

        <AnalyticsDashboard 
          summary={summary}
          channelData={channelData}
          metrics={metrics}
        />
      </div>
    </div>
  );
};

export default AnalyticsPage;