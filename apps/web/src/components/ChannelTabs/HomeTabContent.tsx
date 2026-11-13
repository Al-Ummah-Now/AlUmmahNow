'use client';

import React from 'react';
import { ChannelSections } from '@/components/ChannelSections';
import type { ChannelHomeFallback, PopulatedChannelSection } from '@/components/ChannelSections/sectionData';

interface HomeTabContentProps {
  channelId: string;
  /** The sections the server already read (server-rendered tab): not fetched again */
  initialSections?: PopulatedChannelSection[];
  initialFallback?: ChannelHomeFallback;
  initialPartial?: boolean;
}

export function HomeTabContent({ channelId, initialSections, initialFallback, initialPartial }: HomeTabContentProps) {
  return (
    <div role="tabpanel" id="tabpanel-home" data-testid="tabpanel-home" aria-labelledby="tab-home">
      <ChannelSections channelId={channelId} initialSections={initialSections} initialFallback={initialFallback} initialPartial={initialPartial} />
    </div>
  );
}
