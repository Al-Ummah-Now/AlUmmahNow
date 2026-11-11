'use client';

/**
 * Explore page (LTR / English) - Story 29.7
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { LiveStreamCard } from '@/components/live-streaming/LiveStreamCard';
import { useExplore } from '@/hooks/useExplore';
import { ExploreBody } from './ExploreBody';

export default function Explore() {
  const model = useExplore();
  const router = useRouter();
  return (
    <div dir="ltr" lang="en" className="w-full">
      <ExploreBody
        model={model}
        renderLiveCard={stream => <LiveStreamCard stream={stream} variant="compact" onPlay={() => router.push(`/en/live/${encodeURIComponent(stream.id)}`)} />}
      />
    </div>
  );
}
