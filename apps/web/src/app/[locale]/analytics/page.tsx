'use client';

import { logger } from '@/lib/logger-client';
import React, { useState, useEffect } from 'react';
import { login } from '@/lib/actions';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useCurrentChannel } from '@/hooks/useMultiAccount';
import * as AnalyticsAPI from '@/lib/api/analytics';
import { AnalyticsSummary, ChannelAnalyticsData, AnalyticsMetrics } from '@/lib/api/types';
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard';
import AnalyticsDashboardRTL from '@/components/analytics/AnalyticsDashboard/rtl';
import { useLanguage } from '@/hooks/useLanguage';

const AnalyticsPage = () => {
  const { t, lang, isRTL } = useLanguage();
  const auth = useAuth();
  const currentChannel = useCurrentChannel();
  const channelId = currentChannel?.id;
  const userId = auth?.user?.id;
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [channelData, setChannelData] = useState<ChannelAnalyticsData | null>(null);
  const [metrics, setMetrics] = useState<AnalyticsMetrics[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const loadAnalyticsData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Totals and the daily series cover every channel the user owns; the
        // top videos list is for the channel currently selected (if any).
        const [summaryData, metricsData, channelAnalytics] = await Promise.all([
          AnalyticsAPI.getSummary(),
          AnalyticsAPI.getMetrics(),
          channelId ? AnalyticsAPI.getChannelAnalytics(channelId) : Promise.resolve(null),
        ]);

        if (cancelled) return;
        setSummary(summaryData);
        setMetrics(metricsData);
        setChannelData(channelAnalytics);
      } catch (err) {
        if (cancelled) return;
        setError(t.errors.genericError);
        logger.error('[AnalyticsPage] Failed to load analytics', { error: err });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadAnalyticsData();
    return () => {
      cancelled = true;
    };
  }, [userId, channelId, t]);

  const Dashboard = isRTL ? AnalyticsDashboardRTL : AnalyticsDashboard;

  if (!userId) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-3">
            {t.analytics.dashboard.signInTitle}
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{t.analytics.dashboard.signInMessage}</p>
          <form action={login.bind(null, lang)}>
            <button
              type="submit"
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              {t.navigation.signIn}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">{t.common.loading}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
            {t.common.error}
          </h2>
          <p className="text-gray-600 dark:text-gray-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
            {t.analytics.analyticsTitle}
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            {t.analytics.trackPerformance}
          </p>
        </div>

        <Dashboard
          summary={summary}
          channelData={channelData}
          metrics={metrics}
        />
      </div>
    </div>
  );
};

export default AnalyticsPage;
