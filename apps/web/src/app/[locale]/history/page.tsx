'use client';

import React from 'react';
import WatchHistoryPage from '@/components/watchHistory';
import WatchHistoryPageRTL from '@/components/watchHistory/rtl';
import { useLanguage } from '@/hooks/useLanguage';

export default function HistoryPage() {
  const { isRTL } = useLanguage();
  return isRTL ? <WatchHistoryPageRTL /> : <WatchHistoryPage />;
}
