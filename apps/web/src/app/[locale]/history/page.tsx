'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import WatchHistoryPage from '@/components/watchHistory';
import WatchHistoryPageRTL from '@/components/watchHistory/rtl';
import { useLanguage } from '@/hooks/useLanguage';

/** `?view=continue` is the Continue watching view the home page's card opens */
function HistoryView() {
  const { isRTL } = useLanguage();
  const view = useSearchParams()?.get('view') === 'continue' ? 'continue' : 'all';
  return isRTL ? <WatchHistoryPageRTL view={view} /> : <WatchHistoryPage view={view} />;
}

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryView />
    </Suspense>
  );
}
