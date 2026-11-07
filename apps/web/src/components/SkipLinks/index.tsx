'use client';

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { SkipLinksBase } from './SkipLinksBase';
import SkipLinksRTL from './rtl';

export { MAIN_CONTENT_ID, VIDEO_PLAYER_ID, COMMENTS_ID } from './SkipLinksBase';

/**
 * LTR skip links. The root layout cannot know the locale on the server, so on
 * an RTL route this defers to the RTL variant.
 */
export default function SkipLinks() {
  const { isRTL } = useLanguage();
  if (isRTL) return <SkipLinksRTL />;
  return <SkipLinksBase dir="ltr" />;
}
