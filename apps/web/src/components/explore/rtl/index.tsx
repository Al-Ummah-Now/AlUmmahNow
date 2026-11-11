'use client';

/**
 * Explore page (RTL / Arabic) - Story 29.7
 * Uses the RTL live-stream card; rails and grids mirror via logical spacing.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { LiveStreamCardRTL } from '@/components/live-streaming/LiveStreamCard/rtl';
import { useExplore } from '@/hooks/useExplore';
import { ExploreBody } from '../ExploreBody';

export default function ExploreRTL() {
  const model = useExplore();
  const router = useRouter();
  return (
    <div dir="rtl" lang="ar" className="w-full">
      <ExploreBody
        model={model}
        renderLiveCard={stream => <LiveStreamCardRTL stream={stream} variant="compact" onPlay={() => router.push(`/ar/live/${encodeURIComponent(stream.id)}`)} />}
      />
    </div>
  );
}
