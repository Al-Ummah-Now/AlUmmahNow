'use client';

import React from 'react';
import Link from '@/components/common/AppLink';
import { cn } from '@/lib/utils';

interface UploadButtonProps {
  /**
   * The upload destination URL (for Link variant)
   */
  href?: string;

  /**
   * Click handler (for button variant)
   */
  onClick?: () => void;

  /**
   * Button text
   */
  text: string;

  /**
   * Whether to show icon
   * @default true
   */
  showIcon?: boolean;

  /**
   * Whether to hide text on mobile
   * @default false
   */
  hideTextOnMobile?: boolean;

  /**
   * Button size variant
   * @default 'default'
   */
  size?: 'sm' | 'default' | 'lg';

  /**
   * Whether button is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Optional title attribute for accessibility
   */
  title?: string;

  /**
   * Optional test id for E2E tests
   */
  testId?: string;
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  default: 'px-4 py-2',
  lg: 'px-6 py-3 text-lg',
};

const iconSizes = {
  sm: 16,
  default: 20,
  lg: 24,
};

/**
 * Reusable Upload Button Component
 *
 * Can be used as either a Link or a button element.
 * Flat Material filled styling (the theme's primary), consistent across the app.
 *
 * @example
 * // As a link (navigation)
 * <UploadButton
 *   href="/en/upload"
 *   text="Upload Video"
 *   hideTextOnMobile
 * />
 *
 * @example
 * // As a button (action)
 * <UploadButton
 *   onClick={handleUpload}
 *   text="Start Upload"
 *   disabled={!isValid}
 * />
 */
export function UploadButton({
  href,
  onClick,
  text,
  showIcon = true,
  hideTextOnMobile = false,
  size = 'default',
  disabled = false,
  className,
  title,
  testId,
}: UploadButtonProps) {
  const baseClasses = cn(
    // Layout
    'inline-flex items-center gap-2',
    // Sizing
    sizeClasses[size],
    // Flat Material filled (packages/fanous-tokens/surfaces): the theme's primary, a state layer on hover
    'bg-[var(--aun-btn-filled-bg)] text-[var(--aun-btn-filled-fg)]',
    'hover:bg-[color-mix(in_srgb,var(--aun-btn-filled-fg)_8%,var(--aun-btn-filled-bg))]',
    // Effects
    'rounded-[var(--aun-radius-button)] font-medium',
    'transition-all',
    // Focus
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] focus-visible:ring-offset-2',
    // Disabled state
    disabled && 'opacity-50 cursor-not-allowed',
    // Custom classes
    className
  );

  const iconSize = iconSizes[size];

  const content = (
    <>
      {showIcon && (
        <svg
          className={cn('flex-shrink-0', `w-${iconSize / 4} h-${iconSize / 4}`)}
          style={{ width: iconSize, height: iconSize }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
      )}
      <span className={hideTextOnMobile ? 'hidden md:inline' : undefined}>
        {text}
      </span>
    </>
  );

  // Render as Link if href is provided
  if (href) {
    return (
      <Link
        href={href}
        className={baseClasses}
        title={title || text}
        aria-label={text}
        data-testid={testId}
      >
        {content}
      </Link>
    );
  }

  // Otherwise render as button
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={baseClasses}
      title={title || text}
      aria-label={text}
      data-testid={testId}
    >
      {content}
    </button>
  );
}
