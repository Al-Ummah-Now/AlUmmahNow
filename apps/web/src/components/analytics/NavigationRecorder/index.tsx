'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { recordNavigation } from '@/lib/analytics/traffic-source';

/** Remembers the previous in-app page so views can name their traffic source. */
export function NavigationRecorder() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) recordNavigation(pathname);
  }, [pathname]);
  return null;
}
