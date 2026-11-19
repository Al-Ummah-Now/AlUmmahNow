/**
 * Billing settings (/en/settings/billing, /ar/settings/billing; wiki AUN-SUBS):
 * the signed-in user's subscriptions (cancel, provider portal) and payments.
 */

'use client';

import { useAuth } from '@/components/AuthProvider/authContext';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import { BillingSettings } from '@/components/billing/BillingSettings';
import { useLanguage } from '@/hooks/useLanguage';
import { useFeatures } from '@/hooks/useFeatures';
import NotFoundPage from '@/components/NotFoundPage';

export default function BillingSettingsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { ready, features } = useFeatures();
  if (!user) return <SignInPrompt title={t.settings?.signInTitle || t.navigation.signIn} message={t.billing.settings.description} />;
  // Hidden when off: no provider on and nothing to show for this account → the site's 404, never an empty page
  if (ready && !features.billing) return <NotFoundPage />;
  return <BillingSettings />;
}
