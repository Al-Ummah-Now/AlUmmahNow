/**
 * EmptyState Component Types
 * Task 1.11: Empty States for No Streams
 */

import { LucideIcon } from 'lucide-react';

/**
 * Variant types for empty states
 */
export type EmptyStateVariant = 'no-live' | 'no-scheduled' | 'no-ended' | 'no-results' | 'error';

/**
 * Action configuration for empty state CTA button
 */
export interface EmptyStateAction {
  /**
   * Button label
   */
  label: string;

  /**
   * Click handler (for button actions)
   */
  onClick?: () => void;

  /**
   * Navigation URL (for link actions)
   */
  href?: string;

  /**
   * Button variant
   * @default 'primary'
   */
  variant?: 'primary' | 'secondary' | 'outline';
}

/**
 * Props for the EmptyState component
 */
export interface EmptyStateProps {
  /**
   * Predefined empty state variant
   * If provided, uses default configuration for that variant
   */
  variant?: EmptyStateVariant;

  /**
   * Custom title (overrides variant default)
   */
  title?: string;

  /**
   * Custom message (overrides variant default)
   */
  message?: string;

  /**
   * Custom icon component (overrides variant default)
   */
  icon?: LucideIcon;

  /**
   * Custom action configuration (overrides variant default)
   */
  action?: EmptyStateAction;

  /**
   * Optional CSS class name
   */
  className?: string;

  /**
   * Whether to show the icon
   * @default true
   */
  showIcon?: boolean;

  /**
   * Icon color class
   */
  iconColor?: string;
}
