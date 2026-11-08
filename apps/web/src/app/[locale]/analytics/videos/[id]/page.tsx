'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { login } from '@/lib/actions';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { VideoAnalyticsView } from '@/components/analytics/VideoAnalyticsView';

/** /[locale]/analytics/videos/[id]: per-video analytics for the owner (#241). */
export default function VideoAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t, lang, isRTL } = useLanguage();

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-3">{t.analytics.dashboard.signInTitle}</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{t.analytics.dashboard.signInMessage}</p>
          <form action={login.bind(null, lang)}>
            <button type="submit" className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
              {t.navigation.signIn}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <VideoAnalyticsView videoId={decodeURIComponent(params.id)} />
    </div>
  );
}
