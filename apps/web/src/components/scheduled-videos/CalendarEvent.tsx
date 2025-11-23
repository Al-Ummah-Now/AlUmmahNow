/**
 * CalendarEvent Component
 * Displays a video event in the calendar
 */

'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { formatScheduledTime } from '@/utils/dateFormatters';

export interface CalendarEventProps {
  id: string;
  title: string;
  thumbnailUrl?: string;
  scheduledDate: Date;
  onClick?: (id: string) => void;
  locale?: 'en' | 'ar';
  className?: string;
}

export function CalendarEvent({
  id,
  title,
  thumbnailUrl,
  scheduledDate,
  onClick,
  locale = 'en',
  className = '',
}: CalendarEventProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleClick = async () => {
    if (onClick) {
      setIsLoading(true);
      try {
        await onClick(id);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const scheduledTime = formatScheduledTime(scheduledDate, locale);
  const truncatedTitle = title.length > 50 ? `${title.substring(0, 47)}...` : title;

  return (
    <div
      className={`group relative bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer ${className}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`Video: ${title}. Scheduled ${scheduledTime}`}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-800/80 rounded-lg z-10">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
        </div>
      )}

      {thumbnailUrl && !imageError ? (
        <div className="relative w-full h-20 overflow-hidden rounded-t-lg">
          <Image
            src={thumbnailUrl}
            alt={title}
            fill
            className="object-cover"
            onError={() => setImageError(true)}
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        </div>
      ) : (
        <div className="w-full h-20 bg-gray-200 dark:bg-gray-700 rounded-t-lg flex items-center justify-center">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}

      <div className="p-2">
        <h3
          className="text-sm font-medium text-gray-900 dark:text-white mb-1"
          title={title}
        >
          {truncatedTitle}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{scheduledTime}</p>
      </div>
    </div>
  );
}
