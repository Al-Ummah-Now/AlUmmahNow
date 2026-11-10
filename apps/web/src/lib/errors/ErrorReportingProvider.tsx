'use client';

import { useEffect } from 'react';
import { getReporter, setErrorContext } from './reporter';

/**
 * Mounted once in the root layout: installs the window listeners (uncaught
 * errors, unhandled rejections, failed chunk loads, flush with sendBeacon
 * when the page is hidden) and passes the server-side context (signed-in
 * usr_ id, Worker version, environment) to every report.
 */
export function ErrorReportingProvider({ userId, workerVersion, environment }: { userId?: string; workerVersion?: string; environment?: string }) {
  setErrorContext({ userId, workerVersion, environment });

  useEffect(() => {
    const reporter = getReporter();
    return reporter ? reporter.install() : undefined;
  }, []);

  return null;
}
