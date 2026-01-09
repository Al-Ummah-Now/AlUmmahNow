'use client';

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';

export function AboutTabContent() {
  const { t } = useLanguage();

  return (
    <div role="tabpanel" id="tabpanel-about" aria-labelledby="tab-about">
      <div className="max-w-4xl">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          {t.channel.about}
        </h2>
        <div className="space-y-6">
          {/* Description Section */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
              {t.channel.description}
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              {t.channel.noDescription}
            </p>
          </div>

          {/* Statistics Section */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
              {t.channel.statistics}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.channel.joined}
                </p>
                <p className="text-gray-900 dark:text-white">-</p>
              </div>
            </div>
          </div>

          {/* Links Section */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
              {t.channel.links}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t.common.noResults}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
