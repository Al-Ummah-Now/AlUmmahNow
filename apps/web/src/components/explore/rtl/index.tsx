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
        // The live watch page (/live/{id}) ships with story 29.17; until then cards open the live listing.
        renderLiveCard={stream => <LiveStreamCardRTL stream={stream} variant="compact" onPlay={() => router.push('/ar/live')} />}
      />
    </div>
  );
}
