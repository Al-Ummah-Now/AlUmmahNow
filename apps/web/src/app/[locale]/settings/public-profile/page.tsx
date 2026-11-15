/**
 * Public profile settings (Story 29.5): /en/settings/public-profile, /ar/settings/public-profile.
 */

'use client';

import { publicProfileTranslations } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import { PublicProfileSettings } from '@/components/publicProfile/PublicProfileSettings';

export default function PublicProfileSettingsPage() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const t = publicProfileTranslations(lang).settings;
  if (!user) return <SignInPrompt title={t.signInTitle} message={t.signInMessage} />;
  return <PublicProfileSettings locale={lang} />;
}
