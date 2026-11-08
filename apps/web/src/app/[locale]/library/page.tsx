'use client';

import React from 'react';
import { LibraryHubPage } from '@/components/library';
import { LibraryHubPageRTL } from '@/components/library/rtl';
import { useLanguage } from '@/hooks/useLanguage';

export default function LibraryRoute() {
  const { isRTL } = useLanguage();
  return isRTL ? <LibraryHubPageRTL /> : <LibraryHubPage />;
}
