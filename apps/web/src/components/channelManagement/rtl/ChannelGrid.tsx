import React from 'react';
import { ChannelGridProps } from '../types';
import { ChannelCardRTL } from './ChannelCard';

/**
 * ChannelGrid Component (RTL - Arabic)
 * Responsive grid layout for channel cards with RTL support
 * - 3 columns on desktop (lg)
 * - 2 columns on tablet (md)
 * - 1 column on mobile
 */
export const ChannelGridRTL: React.FC<ChannelGridProps> = ({
  channels,
  onEdit,
  onDelete,
  onView,
  onCreate,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-gray-200 dark:bg-gray-700 rounded-lg h-[280px] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (!channels || channels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <svg
            className="w-12 h-12 text-gray-400 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          لا توجد قنوات بعد
        </h3>
        <p className="text-gray-600 dark:text-gray-400 text-center mb-6 max-w-md">
          أنشئ قناتك الأولى لبدء مشاركة مقاطع الفيديو وبناء جمهورك.
        </p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          أنشئ قناتك الأولى
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Channel Cards */}
      {channels.map((channel) => (
        <ChannelCardRTL
          key={channel.id}
          channel={channel}
          onEdit={onEdit}
          onDelete={onDelete}
          onView={onView}
        />
      ))}
    </div>
  );
};
