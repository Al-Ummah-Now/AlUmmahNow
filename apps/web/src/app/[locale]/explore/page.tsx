'use client';

import React, { Suspense } from 'react';
import Explore from '@/components/explore';
import ExploreRTL from '@/components/explore/rtl';
import { useLanguage } from '@/hooks/useLanguage';

/**
 * /[locale]/explore - Explore page (Story 29.7): trending by language,
 * categories, live now, new channels and config-driven seasonal rails.
 */
export default function ExplorePage() {
  const { isRTL } = useLanguage();
  return (
    <Suspense fallback={null}>
      {isRTL ? <ExploreRTL /> : <Explore />}
    </Suspense>
  );
}
