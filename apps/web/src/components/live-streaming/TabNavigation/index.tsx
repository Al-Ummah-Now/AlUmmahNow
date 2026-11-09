/**
 * TabNavigation Component (LTR)
 * Task 1.8: Tab Navigation (Live Now, Scheduled, Past Streams)
 *
 * Accessible, keyboard-navigable tab component for filtering streams by status
 * with proper ARIA attributes and visual feedback.
 */

'use client';

import React, { useCallback, useRef } from 'react';
import { Radio, Calendar, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TabNavigationProps, TabConfig } from './types';

/**
 * Default tab configurations
 * Can be overridden via props
 */
const DEFAULT_TABS: TabConfig[] = [
  {
    value: 'live',
    label: 'Live Now',
    icon: Radio
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    icon: Calendar
  },
  {
    value: 'ended',
    label: 'Past Streams',
    icon: Clock
  }
];

/**
 * TabNavigation Component
 *
 * Provides an accessible tab interface for filtering live streams by status.
 * Supports keyboard navigation (Tab, Arrow keys, Space/Enter), ARIA attributes,
 * and visual feedback for active/hover states.
 *
 * Features:
 * - ARIA tablist pattern with proper roles and attributes
 * - Keyboard navigation (Arrow keys, Tab, Space/Enter)
 * - Visual active/hover states with smooth transitions
 * - Optional count badges for each tab
 * - Mobile-responsive with scrollable overflow
 * - Dark mode support
 * - Customizable tabs configuration
 *
 * @example
 * ```tsx
 * <TabNavigation
 *   activeTab={activeTab}
 *   onTabChange={setActiveTab}
 *   tabs={[
 *     { value: 'live', label: 'Live Now', count: 5 },
 *     { value: 'scheduled', label: 'Scheduled', count: 12 }
 *   ]}
 * />
 * ```
 */
export const TabNavigation = React.memo<TabNavigationProps>(
  ({
    activeTab,
    onTabChange,
    tabs = DEFAULT_TABS,
    className,
    showCounts = true
  }) => {
    const tablistRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    // Handle keyboard navigation
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLButtonElement>, currentTab: TabConfig) => {
        const currentIndex = tabs.findIndex(tab => tab.value === currentTab.value);
        let nextIndex: number | null = null;

        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
            break;
          case 'ArrowRight':
            e.preventDefault();
            nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
            break;
          case 'Home':
            e.preventDefault();
            nextIndex = 0;
            break;
          case 'End':
            e.preventDefault();
            nextIndex = tabs.length - 1;
            break;
        }

        if (nextIndex !== null) {
          const nextTab = tabs[nextIndex];
          const nextButton = tabRefs.current.get(nextTab.value);
          if (nextButton) {
            nextButton.focus();
            onTabChange(nextTab.value);
          }
        }
      },
      [tabs, onTabChange]
    );

    // Handle tab click
    const handleClick = useCallback(
      (tab: TabConfig) => {
        onTabChange(tab.value);
      },
      [onTabChange]
    );

    // Set tab ref
    const setTabRef = useCallback((value: string, element: HTMLButtonElement | null) => {
      if (element) {
        tabRefs.current.set(value, element);
      } else {
        tabRefs.current.delete(value);
      }
    }, []);

    return (
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Stream filters"
        className={cn(
          'flex items-center',
          'border-b border-gray-200 dark:border-gray-700',
          'overflow-x-auto scrollbar-hide',
          className
        )}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.value;
          const Icon = tab.icon;

          return (
            <button
              key={tab.value}
              ref={(el) => setTabRef(tab.value, el)}
              role="tab"
              aria-selected={isActive}
              aria-controls={`${tab.value}-panel`}
              id={`${tab.value}-tab`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleClick(tab)}
              onKeyDown={(e) => handleKeyDown(e, tab)}
              className="tab-item"
            >
              {/* Icon */}
              {Icon && (
                <Icon
                  className={cn(
                    'w-4 h-4 md:w-5 md:h-5 flex-shrink-0',
                    isActive && 'text-primary'
                  )}
                  aria-hidden="true"
                />
              )}

              {/* Label */}
              <span>{tab.label}</span>

              {/* Count Badge */}
              {showCounts && tab.count !== undefined && (
                <span
                  className={cn(
                    'ml-1 md:ml-2 px-2 py-0.5',
                    'rounded-full',
                    'text-xs font-semibold',
                    'transition-colors duration-200',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  )}
                  aria-label={`${tab.count} ${tab.label.toLowerCase()}`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }
);

TabNavigation.displayName = 'TabNavigation';

export default TabNavigation;
export type { TabNavigationProps, TabConfig } from './types';
