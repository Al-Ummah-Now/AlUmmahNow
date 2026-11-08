'use client';

import { logger } from '@/lib/logger-client';
import React, { useState, useEffect } from 'react';
import { login } from '@/lib/actions';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useCurrentChannel } from '@/hooks/useMultiAccount';
import * as AnalyticsAPI from '@/lib/api/analytics';
import type { AnalyticsDashboardData } from '@/lib/api/analytics';
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard';
import AnalyticsDashboardRTL from '@/components/analytics/AnalyticsDashboard/rtl';
import { useLanguage } from '@/hooks/useLanguage';

const AnalyticsPage = () => {
  const { t, lang, isRTL } = useLanguage();
  const auth = useAuth();
  const currentChannel = useCurrentChannel();
  const channelId = currentChannel?.id;
  const userId = auth?.user?.id;
  const [data, setData] = useState<AnalyticsDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Deliberately keyed on the user and channel only: translations swap in
  // after the first render and must not discard a load already in flight.
  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setFailed(false);
    AnalyticsAPI.getAnalyticsDashboard(channelId)
      .then((result) => {
        if (cancelled) return;
        // Signed-in users always get totals (zeros without channels); none
        // means the API failed or timed out.
        if (!result.summary && !result.metrics) {
          setFailed(true);
          logger.error('[AnalyticsPage] Analytics API returned no data', { channelId });
          return;
        }
        setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed(true);
        logger.error('[AnalyticsPage] Failed to load analytics', { error: err });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, channelId]);

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

  if (failed) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
            {t.common.error}
          </h2>
          <p className="text-gray-600 dark:text-gray-300">{t.errors.genericError}</p>
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
          summary={data?.summary ?? null}
          channelData={data?.channel ?? null}
          metrics={data?.metrics ?? null}
        />
      </div>
    </div>
  );
};

export default AnalyticsPage;
