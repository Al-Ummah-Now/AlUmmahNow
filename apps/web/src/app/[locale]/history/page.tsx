'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import WatchHistoryPage from '@/components/watchHistory';

/** `?view=continue` is the Continue watching view the home page's library row opens */
function HistoryView() {
  const view = useSearchParams()?.get('view') === 'continue' ? 'continue' : 'all';
  return <WatchHistoryPage view={view} />;
}

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryView />
    </Suspense>
  );
}
