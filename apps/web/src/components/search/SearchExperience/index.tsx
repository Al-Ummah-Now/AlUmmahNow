'use client';

/**
 * Search page (LTR / English) - Story 29.8
 */

import React from 'react';
import { useSearchPage } from '@/hooks/useSearchPage';
import { SearchPageBody } from './SearchPageBody';

export default function SearchExperience() {
  const model = useSearchPage();
  return (
    <div dir="ltr" lang="en" className="w-full">
      <SearchPageBody model={model} />
    </div>
  );
}
