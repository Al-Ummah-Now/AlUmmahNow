import React from 'react';
import { Metadata } from 'next';
import {
  RecentVideosSection,
  PopularVideosSection,
  TrendingVideosSection,
  RecommendedVideosSection,
} from '@/components/VideoSections';
import { getTranslations } from '@/lib/i18n/utils/getTranslations';

/**
 * Video Sections Page
 * Displays all video sections on one page (Recent, Popular, Trending, Recommended)
 */

interface SectionsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: SectionsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslations(locale === 'ar' ? 'ar' : 'en');
  const title = `${t.sections?.pageTitle} | ${t.common.appName}`;
  const description = t.sections?.pageDescription;

  return {
    title,
    description,
    openGraph: { title, description },
    alternates: {
      languages: { en: '/en/sections', ar: '/ar/sections' },
    },
  };
}

export default async function SectionsPage({ params }: SectionsPageProps) {
  const { locale } = await params;
  const t = getTranslations(locale === 'ar' ? 'ar' : 'en');

  return (
    <main className="min-h-screen bg-white dark:bg-gray-900" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-12">
        {/* Page Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            {t.sections?.pageTitle}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t.sections?.pageDescription}
          </p>
        </header>

        {/* Trending Videos Section */}
        <TrendingVideosSection
          limit={12}
          showTrendingBadges={true}
          showViewAll={true}
        />

        {/* Popular Videos Section */}
        <PopularVideosSection
          initialPeriod="weekly"
          limit={12}
          showPeriodSelector={true}
          showViewAll={true}
        />

        {/* Recommended Videos Section */}
        <RecommendedVideosSection
          initialStrategy="popular"
          limit={12}
          showStrategySelector={true}
          showViewAll={true}
        />

        {/* Recent Videos Section */}
        <RecentVideosSection
          limit={12}
          showViewAll={true}
        />
      </div>
    </main>
  );
}
