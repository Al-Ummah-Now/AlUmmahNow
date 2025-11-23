import React from 'react';
import { Metadata } from 'next';
import {
  RecentVideosSection,
  PopularVideosSection,
  TrendingVideosSection,
  RecommendedVideosSection,
} from '@/components/VideoSections';

/**
 * Video Sections Page
 * Displays all video sections on one page (Recent, Popular, Trending, Recommended)
 */

export const metadata: Metadata = {
  title: 'Video Sections - Al Ummah Now',
  description: 'Browse recent, popular, trending, and recommended Islamic videos',
  openGraph: {
    title: 'Video Sections - Al Ummah Now',
    description: 'Browse recent, popular, trending, and recommended Islamic videos',
  },
};

export default function SectionsPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-12">
        {/* Page Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Explore Videos
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Discover Islamic content across different categories
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
