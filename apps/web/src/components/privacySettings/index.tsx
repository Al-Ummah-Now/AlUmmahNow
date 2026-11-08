'use client';

/**
 * Privacy & data settings, LTR variant plus the locale-aware entry point.
 */

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { PrivacySettingsView } from './PrivacySettingsView';
import { PrivacySettingsRTL } from './rtl';

export function PrivacySettingsLTR({ signedIn }: { signedIn: boolean }) {
  return <PrivacySettingsView dir="ltr" signedIn={signedIn} />;
}

export function PrivacySettings({ signedIn }: { signedIn: boolean }) {
  const { isRTL } = useLanguage();
  return isRTL ? <PrivacySettingsRTL signedIn={signedIn} /> : <PrivacySettingsLTR signedIn={signedIn} />;
}

export default PrivacySettings;
