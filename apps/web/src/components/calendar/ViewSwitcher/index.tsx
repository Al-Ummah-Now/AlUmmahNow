/**
 * ViewSwitcher Component (LTR)
 *
 * Allows users to switch between list and calendar views
 * for scheduled videos.
 */

'use client';

import React from 'react';
import { List, Calendar } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

export type ViewMode = 'list' | 'calendar';

interface ViewSwitcherProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  className?: string;
}

export function ViewSwitcher({
  currentView,
  onViewChange,
  className = '',
}: ViewSwitcherProps) {
  const { t } = useLanguage();

  return (
    <div role="group" aria-label={t.schedule?.scheduledVideos} className={`inline-flex rounded-lg border border-gray-300 dark:border-gray-600 ${className}`}>
      <button
        onClick={() => onViewChange('list')}
        className={`
          flex items-center gap-2 px-4 py-2 text-sm font-medium
          rounded-s-lg transition-colors
          ${
            currentView === 'list'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }
        `}
        aria-label={t.schedule?.views?.list ?? 'List'}
        data-testid="view-switch-list"
        type="button"
        aria-pressed={currentView === 'list'}
      >
        <List size={18} />
        <span>{t.schedule?.views?.list ?? 'List'}</span>
      </button>

      <button
        onClick={() => onViewChange('calendar')}
        className={`
          flex items-center gap-2 px-4 py-2 text-sm font-medium
          rounded-e-lg transition-colors border-s border-gray-300 dark:border-gray-600
          ${
            currentView === 'calendar'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }
        `}
        aria-label={t.schedule?.views?.calendar ?? 'Calendar'}
        data-testid="view-switch-calendar"
        type="button"
        aria-pressed={currentView === 'calendar'}
      >
        <Calendar size={18} />
        <span>{t.schedule?.views?.calendar ?? 'Calendar'}</span>
      </button>
    </div>
  );
}
