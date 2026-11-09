/**
 * EmptyState Component (RTL)
 * Task 1.11: Empty States for No Streams
 *
 * RTL variant with Arabic labels and right-to-left layout
 */

'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { VideoOff, Calendar, Clock, Search, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EmptyStateProps, EmptyStateVariant, EmptyStateAction } from '../types';

/**
 * Default configurations for each empty state variant (Arabic)
 */
const EMPTY_STATE_CONFIGS_AR: Record<
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
    title: 'لا توجد بثوث مباشرة الآن',
    message: 'تحقق مرة أخرى لاحقاً أو تصفح المحتوى المسجل',
    action: {
      label: 'تصفح التسجيلات',
      href: '/ar/videos'
    },
    iconColor: 'text-gray-400 dark:text-gray-600'
  },
  'no-scheduled': {
    icon: Calendar,
    title: 'لا توجد بثوث مجدولة',
    message: 'تابع قنواتك المفضلة للحصول على إشعار عند البث المباشر',
    action: {
      label: 'تصفح القنوات',
      href: '/ar/channels'
    },
    iconColor: 'text-brand-ink dark:text-brand-ink'
  },
  'no-ended': {
    icon: Clock,
    title: 'لا توجد بثوث سابقة متاحة',
    message: 'ستظهر البثوث السابقة هنا بعد انتهائها',
    iconColor: 'text-gray-400 dark:text-gray-600'
  },
  'no-results': {
    icon: Search,
    title: 'لا توجد بثوث تطابق البحث',
    message: 'حاول تعديل معايير البحث أو تصفح جميع البثوث',
    iconColor: 'text-blue-400 dark:text-blue-600'
  },
  'error': {
    icon: AlertTriangle,
    title: 'حدث خطأ ما',
    message: 'لم نتمكن من تحميل البثوث. يرجى المحاولة مرة أخرى.',
    iconColor: 'text-red-400 dark:text-red-600'
  }
};

/**
 * EmptyStateRTL Component
 *
 * Arabic/RTL variant of EmptyState with:
 * - Arabic labels and messages
 * - RTL text direction
 * - Mirrored layout for icons and buttons
 * - All other features from LTR version
 */
export const EmptyStateRTL = React.memo<EmptyStateProps>(
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
      const variantConfig = EMPTY_STATE_CONFIGS_AR[variant];
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
        dir="rtl"
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

EmptyStateRTL.displayName = 'EmptyStateRTL';

export default EmptyStateRTL;
