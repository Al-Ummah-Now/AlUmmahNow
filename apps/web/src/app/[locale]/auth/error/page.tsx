import type { Metadata } from 'next';
import { errorPageTitle } from '@al-ummah/shared-types';
import { getTranslations } from '@/lib/i18n/utils/getTranslations';
import AuthErrorPage from '@/components/AuthErrorPage';

/** The family's tab title and robots (wiki guides/error-pages.md): never indexed. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const lang = (await params).locale === 'ar' ? 'ar' : 'en';
  return { title: { absolute: errorPageTitle(lang, getTranslations(lang).auth.callbackErrorTitle) }, robots: { index: false, follow: false } };
}

/**
 * Landing page for a sign-in that came back from the auth server with an
 * error (or without a code). /api/callback redirects here instead of
 * answering with raw JSON.
 */
export default function AuthError() {
  return <AuthErrorPage />;
}
