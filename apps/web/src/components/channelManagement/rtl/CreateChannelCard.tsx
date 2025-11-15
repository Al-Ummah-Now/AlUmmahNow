import React from 'react';
import { CreateChannelCardProps } from '../types';

/**
 * CreateChannelCard Component (RTL - Arabic)
 * Card with plus icon to trigger channel creation dialog
 * Includes RTL layout adjustments and Arabic text
 */
export const CreateChannelCardRTL: React.FC<CreateChannelCardProps> = ({ onClick }) => {
  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 overflow-hidden cursor-pointer border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 flex flex-col items-center justify-center p-8 min-h-[280px]"
      dir="rtl"
    >
      <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-4 transition-transform hover:scale-110">
        <svg
          className="w-8 h-8 text-blue-600 dark:text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        إنشاء قناة جديدة
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
        ابدأ مشاركة محتواك مع قناة جديدة
      </p>
    </div>
  );
};
