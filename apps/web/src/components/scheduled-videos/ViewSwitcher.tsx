/**
 * ViewSwitcher Component
 * Toggles between list and calendar views for scheduled videos
 */

'use client';

import React from 'react';

export type ViewType = 'list' | 'calendar';

export interface ViewSwitcherProps {
  currentView: ViewType;
  onChange: (view: ViewType) => void;
  className?: string;
}

export function ViewSwitcher({
  currentView,
  onChange,
  className = '',
}: ViewSwitcherProps) {
  return (
    <div
      className={`flex gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 ${className}`}
      role="group"
      aria-label="View switcher"
    >
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          currentView === 'list'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
        }`}
        aria-pressed={currentView === 'list'}
        aria-label="List view"
      >
        <span className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
          List
        </span>
      </button>

      <button
        type="button"
        onClick={() => onChange('calendar')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          currentView === 'calendar'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
        }`}
        aria-pressed={currentView === 'calendar'}
        aria-label="Calendar view"
      >
        <span className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          Calendar
        </span>
      </button>
    </div>
  );
}
