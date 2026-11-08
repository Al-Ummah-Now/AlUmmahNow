'use client';

/**
 * Search page (RTL / Arabic) - Story 29.8
 * Same body as the LTR variant; logical spacing mirrors the layout and the
 * type chips scroll from the right edge.
 */

import React from 'react';
import { useSearchPage } from '@/hooks/useSearchPage';
import { SearchPageBody } from '../SearchPageBody';

export default function SearchExperienceRTL() {
  const model = useSearchPage();
  return (
    <div dir="rtl" lang="ar" className="w-full">
      <SearchPageBody model={model} />
    </div>
  );
}
