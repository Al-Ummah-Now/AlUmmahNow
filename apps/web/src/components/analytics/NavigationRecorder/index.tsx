'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { recordNavigation } from '@/lib/analytics/traffic-source';
import { sendVisitBeacon } from '@/lib/analytics/site-visit';

/**
 * Remembers the previous in-app page so views can name their traffic source, and reports where the
 * visit started (once per tab session, D-SEO-9).
 */
export function NavigationRecorder() {
  const pathname = usePathname();
  useEffect(() => {
    sendVisitBeacon();
  }, []);
  useEffect(() => {
    if (pathname) recordNavigation(pathname);
  }, [pathname]);
  return null;
}
