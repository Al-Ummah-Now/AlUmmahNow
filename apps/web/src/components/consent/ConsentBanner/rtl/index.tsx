'use client';

/**
 * Cookie / tracking consent banner, RTL variant (Arabic). Layout mirrors via
 * `dir="rtl"` and logical (start/end) utilities in the shared view.
 */

import React from 'react';
import { ConsentBannerView } from '../ConsentBannerView';

export function ConsentBannerRTL() {
  return <ConsentBannerView dir="rtl" />;
}

export default ConsentBannerRTL;
