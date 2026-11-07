'use client';

import React, { Suspense } from 'react';
import SearchExperience from '@/components/search/SearchExperience';
import SearchExperienceRTL from '@/components/search/SearchExperience/rtl';
import { useLanguage } from '@/hooks/useLanguage';

/**
 * /[locale]/search - Search v2 (Story 29.8): index-backed multi-type results,
 * filters in the URL, private on-device history.
 */
export default function SearchPage() {
  const { isRTL } = useLanguage();
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      {isRTL ? <SearchExperienceRTL /> : <SearchExperience />}
    </Suspense>
  );
}
