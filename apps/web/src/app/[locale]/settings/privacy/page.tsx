/**
 * Privacy & data settings page (/en/settings/privacy, /ar/settings/privacy).
 *
 * Available to signed-out visitors too: consent choices and on-device data
 * apply to everyone; export and erasure appear once signed in.
 */

'use client';

import { useAuth } from '@/components/AuthProvider/authContext';
import { PrivacySettings } from '@/components/privacySettings';

export default function PrivacySettingsPage() {
  const { user } = useAuth();
  return <PrivacySettings signedIn={!!user} />;
}
