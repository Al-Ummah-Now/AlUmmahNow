/**
 * ViewerCount Component Types
 * Task 1.2: ViewerCount Component
 */

/**
 * Number format variants
 */
export type NumberFormat = 'compact' | 'full';

/**
 * ViewerCount component props
 */
export interface ViewerCountProps {
  /**
   * Current viewer count
   * @default 0
   */
  count: number;

  /**
   * Whether the stream is currently live
   * Applies special styling for live streams
   * @default false
   */
  isLive?: boolean;

  /**
   * Whether to show the "watching" label
   * Hidden on mobile by default
   * @default false
   */
  showLabel?: boolean;

  /**
   * Number formatting style
   * - compact: 1.2K, 1.5M (shorter)
   * - full: 1,234 (complete with separators)
   * @default 'compact'
   */
  format?: NumberFormat;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Optional click handler for refresh functionality
   */
  onClick?: () => void;

  /**
   * Loading state - shows placeholder
   * @default false
   */
  isLoading?: boolean;
}

/**
 * Number formatting options
 */
export interface NumberFormatOptions {
  locale: string;
  notation: 'compact' | 'standard';
  maximumFractionDigits?: number;
  compactDisplay?: 'short' | 'long';
}
