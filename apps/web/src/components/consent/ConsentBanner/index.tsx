'use client';

/**
 * Cookie / tracking consent banner (Story 1.3, AC 4). LTR variant plus the
 * locale-aware entry point used by the root layout.
 */

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { ConsentBannerView } from './ConsentBannerView';
import { ConsentBannerRTL } from './rtl';

export function ConsentBannerLTR() {
  return <ConsentBannerView dir="ltr" />;
}

export function ConsentBanner() {
  const { isRTL } = useLanguage();
  return isRTL ? <ConsentBannerRTL /> : <ConsentBannerLTR />;
}

export default ConsentBanner;
