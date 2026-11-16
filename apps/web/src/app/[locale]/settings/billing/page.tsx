/**
 * Billing settings (/en/settings/billing, /ar/settings/billing; wiki AUN-SUBS):
 * the signed-in user's subscriptions (cancel, provider portal) and payments.
 */

'use client';

import { useAuth } from '@/components/AuthProvider/authContext';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import { BillingSettings } from '@/components/billing/BillingSettings';
import { useLanguage } from '@/hooks/useLanguage';

export default function BillingSettingsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (!user) return <SignInPrompt title={t.settings?.signInTitle || t.navigation.signIn} message={t.billing.settings.description} />;
  return <BillingSettings />;
}
