'use client';

import React from 'react';
import { ChannelSections } from '@/components/ChannelSections';
import type { PopulatedChannelSection } from '@/components/ChannelSections/sectionData';

interface HomeTabContentProps {
  channelId: string;
  /** The sections the server already read (server-rendered tab): not fetched again */
  initialSections?: PopulatedChannelSection[];
}

export function HomeTabContent({ channelId, initialSections }: HomeTabContentProps) {
  return (
    <div role="tabpanel" id="tabpanel-home" data-testid="tabpanel-home" aria-labelledby="tab-home">
      <ChannelSections channelId={channelId} initialSections={initialSections} />
    </div>
  );
}
