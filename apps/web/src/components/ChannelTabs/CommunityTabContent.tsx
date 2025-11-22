'use client';

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';

export function CommunityTabContent() {
  const { t } = useLanguage();

  return (
    <div role="tabpanel" id="tabpanel-community" aria-labelledby="tab-community">
      <div className="text-center py-12">
        <svg
          className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
          />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          {t.channel.community}
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          {t.community.noPostsYet}
        </p>
      </div>
    </div>
  );
}
