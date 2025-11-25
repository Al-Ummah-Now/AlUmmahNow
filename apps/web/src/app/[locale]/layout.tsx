import { logger } from '@/lib/logger-client';
/**
 * Dynamic Locale Layout
 *
 * Root layout for all locale routes (e.g., /en/*, /ar/*, /ur/*, /fr/*).
 *
 * Features:
 * - Locale validation (404 if unsupported)
 * - Text direction (RTL/LTR) based on locale
 * - ProfileGuard integration for user profile management
 * - HTML lang and dir attributes
 */

import React from 'react';
import { notFound } from 'next/navigation';
import ProfileGuard from '@/components/ProfileGuard';
import { isLocaleSupported, getTextDirection } from '@/lib/i18n/utils';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Root layout for dynamic locale routes
 *
 * Validates the locale and sets up the appropriate text direction.
 * Falls back to 404 if the locale is not supported.
 */
export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  // Validate locale - return 404 if not supported
  if (!isLocaleSupported(locale)) {
    logger.warn(`[LocaleLayout] Unsupported locale requested: ${locale}`);
    notFound();
  }

  // Get text direction for the locale
  const dir = getTextDirection(locale);

  // Log locale activation (development only)
  if (process.env.NODE_ENV === 'development') {
    logger.debug(`[LocaleLayout] Activating locale: ${locale} (${dir})`);
  }

  return (
    <ProfileGuard locale={locale as SupportedLocale}>
      <div dir={dir} lang={locale}>
        {children}
      </div>
    </ProfileGuard>
  );
}
