'use client';

import React from 'react';
import { ChannelSections } from '@/components/ChannelSections';

interface HomeTabContentProps {
  channelId: string;
}

export function HomeTabContent({ channelId }: HomeTabContentProps) {
  return (
    <div role="tabpanel" id="tabpanel-home" aria-labelledby="tab-home">
      <ChannelSections channelId={channelId} />
    </div>
  );
}
