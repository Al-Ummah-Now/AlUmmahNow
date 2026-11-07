'use client';

/**
 * Privacy & data settings, RTL variant (Arabic).
 */

import React from 'react';
import { PrivacySettingsView } from '../PrivacySettingsView';

export function PrivacySettingsRTL({ signedIn }: { signedIn: boolean }) {
  return <PrivacySettingsView dir="rtl" signedIn={signedIn} />;
}

export default PrivacySettingsRTL;
