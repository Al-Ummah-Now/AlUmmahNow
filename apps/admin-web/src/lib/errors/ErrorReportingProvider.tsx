'use client';

import { useEffect } from 'react';
import { errorReporter, setErrorContext } from './reporter';

/**
 * Installs the browser reporter once (window error, unhandledrejection,
 * failed /_next/ chunk loads, flush on page hide). Mounted in the root layout.
 */
export function ErrorReportingProvider({ locale, theme }: { locale: string; theme: string }) {
  useEffect(() => {
    setErrorContext({ locale, theme });
  }, [locale, theme]);

  useEffect(() => errorReporter.install(), []);

  return null;
}

/** Adds the signed-in admin's usr_ id to reports. Mounted in the protected layout. */
export function ErrorReportingIdentity({ userId }: { userId?: string }) {
  useEffect(() => {
    setErrorContext({ userId: userId && userId.startsWith('usr_') ? userId : undefined });
    return () => setErrorContext({ userId: undefined });
  }, [userId]);

  return null;
}
