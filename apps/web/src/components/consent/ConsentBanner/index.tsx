'use client';

/**
 * Cookie / tracking consent banner (Story 1.3, AC 4). LTR variant plus the
 * locale-aware entry point used by the root layout.
 */

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { ConsentBannerView } from './ConsentBannerView';
import { ConsentBannerRTL } from './rtl';

export interface ConsentBannerProps {
  /** True when the request carried no valid consent cookie (server-rendered first visit, #1205). */
  initialVisible?: boolean;
}

export function ConsentBannerLTR({ initialVisible }: ConsentBannerProps) {
  return <ConsentBannerView dir="ltr" initialVisible={initialVisible} />;
}

export function ConsentBanner({ initialVisible }: ConsentBannerProps) {
  const { isRTL } = useLanguage();
  return isRTL ? <ConsentBannerRTL initialVisible={initialVisible} /> : <ConsentBannerLTR initialVisible={initialVisible} />;
}

export default ConsentBanner;
