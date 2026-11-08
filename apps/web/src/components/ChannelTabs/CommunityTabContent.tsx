'use client';

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import CommunityPosts from '@/components/Community/CommunityPosts';

interface CommunityTabContentProps {
  channelId: string;
}

/**
 * Channel Community tab: the channel's community posts feed with likes,
 * poll voting and threaded comments. Direction-aware through useLanguage,
 * so it serves both the LTR and RTL channel pages.
 */
export function CommunityTabContent({ channelId }: CommunityTabContentProps) {
  const { isRTL, locale } = useLanguage();

  return (
    <div
      role="tabpanel"
      id="tabpanel-community"
      data-testid="tabpanel-community"
      aria-labelledby="tab-community"
      dir={isRTL ? 'rtl' : 'ltr'}
      className="max-w-3xl mx-auto"
    >
      <CommunityPosts channelId={channelId} isRTL={isRTL} locale={locale} />
    </div>
  );
}
