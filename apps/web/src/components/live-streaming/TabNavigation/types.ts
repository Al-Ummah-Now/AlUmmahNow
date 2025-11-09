/**
 * TabNavigation Component Types
 * Task 1.8: Tab Navigation (Live Now, Scheduled, Past Streams)
 */

import { LucideIcon } from 'lucide-react';

/**
 * Configuration for a single tab
 */
export interface TabConfig {
  /**
   * Unique value for the tab
   */
  value: 'live' | 'scheduled' | 'ended';

  /**
   * Display label for the tab
   */
  label: string;

  /**
   * Optional count badge to show number of items
   */
  count?: number;

  /**
   * Optional icon component
   */
  icon?: LucideIcon;
}

/**
 * Props for the TabNavigation component
 */
export interface TabNavigationProps {
  /**
   * Currently active tab
   */
  activeTab: 'live' | 'scheduled' | 'ended';

  /**
   * Callback when tab is changed
   */
  onTabChange: (tab: 'live' | 'scheduled' | 'ended') => void;

  /**
   * Optional custom tabs configuration
   * If not provided, default tabs will be used
   */
  tabs?: TabConfig[];

  /**
   * Optional CSS class name
   */
  className?: string;

  /**
   * Whether to show count badges
   * @default true
   */
  showCounts?: boolean;
}
