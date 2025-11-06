/**
 * CVA Variants for StreamStatusBadge Component
 * Task 1.1: Stream Status Badge Component
 */

import { cva } from 'class-variance-authority';

/**
 * Badge variants using Class Variance Authority
 */
export const badgeVariants = cva(
  // Base styles applied to all variants
  'inline-flex items-center gap-1.5 rounded font-semibold uppercase transition-colors duration-150',
  {
    variants: {
      status: {
        live: 'bg-red-500 text-white animate-pulse dark:bg-red-600',
        scheduled: 'bg-amber-500 text-white dark:bg-amber-600',
        ended: 'bg-gray-500 text-white dark:bg-gray-600',
        cancelled: 'bg-gray-600 text-white dark:bg-gray-700',
        offline: 'bg-gray-400 text-white dark:bg-gray-500',
      },
      size: {
        sm: 'h-5 text-[10px] px-1.5 py-0.5',
        md: 'h-6 text-xs px-2 py-0.5',
        lg: 'h-7 text-sm px-3 py-1',
      },
    },
    defaultVariants: {
      status: 'offline',
      size: 'md',
    },
  }
);

/**
 * Icon size classes based on badge size
 */
export const iconSizeClasses = {
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
  lg: 'w-3.5 h-3.5',
} as const;
