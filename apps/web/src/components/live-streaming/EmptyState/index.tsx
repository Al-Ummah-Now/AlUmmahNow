/**
 * EmptyState Component (LTR)
 * Task 1.11: Empty States for No Streams
 *
 * Displays helpful, actionable empty state messages for different scenarios
 * when no content is available.
 */

'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { VideoOff, Calendar, Clock, Search, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EmptyStateProps, EmptyStateVariant, EmptyStateAction } from './types';

/**
 * Default configurations for each empty state variant
 */
const EMPTY_STATE_CONFIGS: Record<
  EmptyStateVariant,
  {
    icon: typeof VideoOff;
    title: string;
    message: string;
    action?: EmptyStateAction;
    iconColor: string;
  }
> = {
  'no-live': {
    icon: VideoOff,
    title: 'No live streams right now',
    message: 'Check back later or browse our recorded content',
    action: {
      label: 'Browse Recordings',
      href: '/en/videos'
    },
    iconColor: 'text-gray-400 dark:text-gray-600'
  },
  'no-scheduled': {
    icon: Calendar,
    title: 'No upcoming streams scheduled',
    message: 'Follow your favorite channels to get notified when they go live',
    action: {
      label: 'Browse Channels',
      href: '/en/channels'
    },
    iconColor: 'text-amber-400 dark:text-amber-600'
  },
  'no-ended': {
    icon: Clock,
    title: 'No past streams available',
    message: 'Past streams will appear here after they end',
    iconColor: 'text-gray-400 dark:text-gray-600'
  },
  'no-results': {
    icon: Search,
    title: 'No streams match your filters',
    message: 'Try adjusting your search criteria or browse all streams',
    iconColor: 'text-blue-400 dark:text-blue-600'
  },
  'error': {
    icon: AlertTriangle,
    title: 'Something went wrong',
    message: "We couldn't load the streams. Please try again.",
    iconColor: 'text-red-400 dark:text-red-600'
  }
};

/**
 * EmptyState Component
 *
 * Displays contextual empty state messages with icons, titles, messages,
 * and optional call-to-action buttons. Supports predefined variants or
 * fully custom configurations.
 *
 * Features:
 * - Predefined variants for common scenarios
 * - Custom title, message, icon, and actions
 * - Responsive layout (mobile-first)
 * - Dark mode support
 * - Accessible with proper ARIA attributes
 * - Smooth fade-in animation
 * - Support for both button and link actions
 *
 * @example
 * ```tsx
 * // Using predefined variant
 * <EmptyState variant="no-live" />
 *
 * // Custom empty state
 * <EmptyState
 *   icon={VideoOff}
 *   title="No streams found"
 *   message="Try searching for something else"
 *   action={{ label: "Clear Search", onClick: handleClear }}
 * />
 * ```
 */
export const EmptyState = React.memo<EmptyStateProps>(
  ({
    variant = 'no-live',
    title: customTitle,
    message: customMessage,
    icon: customIcon,
    action: customAction,
    className,
    showIcon = true,
    iconColor: customIconColor
  }) => {
    // Get configuration based on variant
    const config = useMemo(() => {
      const variantConfig = EMPTY_STATE_CONFIGS[variant];
      return {
        icon: customIcon || variantConfig.icon,
        title: customTitle || variantConfig.title,
        message: customMessage || variantConfig.message,
        action: customAction || variantConfig.action,
        iconColor: customIconColor || variantConfig.iconColor
      };
    }, [variant, customIcon, customTitle, customMessage, customAction, customIconColor]);

    const Icon = config.icon;

    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center',
          'py-12 md:py-16 lg:py-20 px-4',
          'text-center',
          'animate-fadeIn',
          className
        )}
        role="status"
        aria-live="polite"
      >
        {/* Icon */}
        {showIcon && Icon && (
          <Icon
            className={cn(
              'w-12 h-12 md:w-16 md:h-16 mb-4 md:mb-6',
              config.iconColor
            )}
            aria-hidden="true"
          />
        )}

        {/* Title */}
        <h3 className="text-lg md:text-xl lg:text-2xl font-semibold text-gray-900 dark:text-white mb-2 md:mb-3">
          {config.title}
        </h3>

        {/* Message */}
        <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mb-6 md:mb-8 max-w-md">
          {config.message}
        </p>

        {/* Action Button/Link */}
        {config.action && (
          <>
            {config.action.href ? (
              <Link
                href={config.action.href}
                className={cn(
                  'inline-flex items-center justify-center',
                  'px-6 py-3 min-h-[44px]',
                  'text-sm md:text-base font-medium',
                  'rounded-lg',
                  'transition-all duration-200',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  config.action.variant === 'secondary'
                    ? 'text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                    : config.action.variant === 'outline'
                    ? 'text-primary border-2 border-primary hover:bg-primary hover:text-white'
                    : 'text-white bg-primary hover:bg-primary/90'
                )}
              >
                {config.action.label}
              </Link>
            ) : (
              <button
                onClick={config.action.onClick}
                className={cn(
                  'inline-flex items-center justify-center',
                  'px-6 py-3 min-h-[44px]',
                  'text-sm md:text-base font-medium',
                  'rounded-lg',
                  'transition-all duration-200',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  config.action.variant === 'secondary'
                    ? 'text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                    : config.action.variant === 'outline'
                    ? 'text-primary border-2 border-primary hover:bg-primary hover:text-white'
                    : 'text-white bg-primary hover:bg-primary/90'
                )}
              >
                {config.action.label}
              </button>
            )}
          </>
        )}
      </div>
    );
  }
);

EmptyState.displayName = 'EmptyState';

export default EmptyState;
export type { EmptyStateProps, EmptyStateVariant, EmptyStateAction } from './types';
