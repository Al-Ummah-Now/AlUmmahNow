/**
 * ViewerCount Component Variants
 * Task 1.2: ViewerCount Component
 */

/**
 * Icon size classes for the Eye icon
 */
export const iconSizeClasses = {
  default: 'w-4 h-4',
} as const;

/**
 * Container styling with live state variants
 */
export const getContainerClasses = (isLive: boolean, isClickable: boolean) => {
  const baseClasses = 'flex items-center gap-1 text-sm font-medium';
  const liveClasses = isLive ? 'text-red-600 dark:text-red-400' : '';
  const clickableClasses = isClickable
    ? 'cursor-pointer transition-transform hover:scale-105 active:scale-95'
    : '';

  return [baseClasses, liveClasses, clickableClasses].filter(Boolean).join(' ');
};

/**
 * Icon color classes based on live state
 */
export const getIconClasses = (isLive: boolean) => {
  const baseClasses = iconSizeClasses.default;
  const colorClasses = isLive
    ? 'text-red-500 dark:text-red-400'
    : 'text-gray-500 dark:text-gray-400';

  return `${baseClasses} ${colorClasses}`;
};

/**
 * Label classes for the "watching" text
 * Hidden on mobile, visible on sm and up
 */
export const labelClasses = 'text-muted-foreground hidden sm:inline';

/**
 * Number classes with tabular nums for consistent width
 */
export const numberClasses = 'tabular-nums';
