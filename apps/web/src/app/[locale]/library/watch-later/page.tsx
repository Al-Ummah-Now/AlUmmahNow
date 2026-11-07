'use client';

import React from 'react';
import { LibraryCollectionPage } from '@/components/library';
import { LibraryCollectionPageRTL } from '@/components/library/rtl';
import { useLanguage } from '@/hooks/useLanguage';

export default function LibraryCollectionRoute() {
  const { isRTL } = useLanguage();
  return isRTL ? <LibraryCollectionPageRTL kind="watch-later" /> : <LibraryCollectionPage kind="watch-later" />;
}
